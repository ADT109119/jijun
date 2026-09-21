# 輕鬆記帳 - 專案結構

本專案是一個基於 HTML/CSS/JavaScript 與 Capacitor 的記帳 Web App。

## 檔案結構與作用

```
src/js/
├── main.js              # 主應用程式 (EasyAccountingApp 類別，路由、頁面渲染、帳本切換器、processAmortizations, updateNavAddIcon)
├── themeManager.js      # 主題管理 (深淺色模式四態切換 system/light/dark/custom、prefers-color-scheme 動態監聽、meta theme-color 同步、套用 CSS 變數、圖示替換；SVG/CSS 注入消毒)
├── aiService.js         # PWA 離線 AI 記帳服務 (wllama WASM + 58M GGUF 推論引擎，含語意守門校正 applySemanticGuardrail、對齊訓練集 Prompt 格式、無痛換模防錯、HEAD ETag 版次檢驗與即時 Token 串流)
├── dataService.js       # IndexedDB 資料存取層 (Schema v15: 多帳本 + 攤提/分期 + 信用卡支援 + 群組分帳與單筆個別還款)
├── ledgerManager.js     # 帳本管理商業邏輯 (建立、切換、刪除帳本)
├── groupManager.js      # 群組分帳管理商業邏輯 (建立、刪除群組、一鍵結清與單筆明細個別還款 settleGroupRecord)
├── categories.js        # 分類常數與工具函數
├── categoryManager.js   # 分類管理 UI 邏輯
├── statistics.js        # 統計分析頁面 (包含跨月比較報表等功能)
├── comparisonReport.js   # 跨月比較報表與 CSV 匯出 (包含結構比例、日均支出、儲蓄率)
├── calendarCashFlow.js   # 行事曆金流檢視 (月曆網格、Top 3 支出標籤、每日明細 Modal)
├── recordsList.js       # 記帳紀錄列表
├── budgetManager.js     # 預算管理
├── quickSelectManager.js# 快速選擇管理
├── debtManager.js       # 欠款與群組管理 (欠款/借貸、聯絡人篩選與關聯群組過濾、群組分帳 AA 帳，支援點擊查看群組細部明細與單筆個別還款)
├── changelog.js         # 更新日誌
├── datePickerModal.js   # 日期選擇器彈窗
├── pluginManager.js     # 擴充功能系統
├── pluginStorage.js     # 插件沙箱化儲存
├── syncService.js       # Google Drive 雲端備份&同步 (含跨裝置 groupMeta 群組資料同步與 UUID 外鍵解析)
├── rewardService.js     # 雙平台廣告服務 (Capacitor AdMob + Web AdSense)
├── tourManager.js       # 導覽功能核心引擎 (GuideManager 類別，歡迎 Modal、氣泡引導、自動實操演示、狀態持久化)
├── tours/               # 導覽定義模組目錄 (包含各功能獨立導覽設定檔與統一註冊表 index.js)
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
├── debtsPage.js         # 欠款管理頁面（極簡直觀顯示個人欠款與待結清群組，前端路由）
├── groupsPage.js        # 獨立群組與專案管理頁面（建立/重命名/刪除/檢視專案與分帳群組）
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
├── main.css             # 主樣式表 (包含 Modal 滑入/滑出與淡入淡出動畫關鍵影格 animate-slide-up / animate-fade-in / animate-modal-pop)
└── tailwind.css         # Tailwind 本地 build 入口 (@tailwind base/components/utilities)

src/fonts/
└── fonts.css            # 本地自託管字體樣式表 (Inter + Noto Sans TC woff2)

src/vendor/
└── qrcode.js            # QRCode.js 本地資產 (以 classic script 注入避免 minifier 重綁 this)

android/                 # Capacitor Android 原生專案
├── app/src/main/
│   ├── AndroidManifest.xml  # 含 AdMob App ID 與 Widget/DeepLink 配置
│   ├── java/com/walkingfish/easyaccounting/
│   │   ├── MainActivity.java           # 註冊 WidgetStoragePlugin
│   │   ├── WidgetStoragePlugin.java     # 自訂儲存插件 (保存桌面統計/載具/捷徑/行事曆 Widget 資料)
│   │   ├── EasyAccountingWidgetProvider.java # 桌面統計小工具 Provider
│   │   ├── InvoiceCarrierWidgetProvider.java # 發票載具小工具 Provider (Code 39 繪製)
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
├── serviceWorker.js     # 離線快取 Service Worker (支援 precachemanifest.json 自動注入與導覽 network-first)
├── vendor/wllama/       # wllama v3.5.1 本地端側 LLM 引擎檔 (esm/index.js + esm/wasm/wllama.wasm)
├── icon/                # 圖示目錄 (包含 icon.png 192px 與 icon-512.png 512px)
├── screenshots/         # PWA 螢幕截圖目錄 (用於應用商店預覽)
└── widgets/             # PWA 桌面小工具定義檔 (包含 template.json 與 data.json)

tools/jijun-ai-training/  # 離線 AI 模型 (jijun-LM) 數據生成與訓練管線
├── generate_dataset.py # 訓練資料集批量生成腳本 (含 80+ 種全方位在地化生活情境、20+ 種口語句型庫、極簡短語 Ultra-Short 強化與 --short_ratio 參數)
├── audit_dataset_llm.py # LLM 逐行資料集質檢與對齊稽核腳本 (支援並行與指數退避重試)
├── fix_unmentioned_accounts.py # 未明確提及支付管道樣本之預設帳戶（現金）校驗修復腳本
├── filter_dataset.py   # 資料集語意對齊過濾器
├── split_dataset.py    # 訓練集/測試集分割腳本 (80/20)
├── train_custom_sft.py # PyTorch 微調 SFT 腳本
├── evaluate_benchmark.py # 基準評測腳本
├── demo_gguf.py        # Gradio/CLI GGUF 推論測試 Demo
└── jijun-LM-GGUF/      # 導出的 GGUF 量化模型權重

tailwind.config.js       # Tailwind CSS 主題與外掛設定檔 (PostCSS build 用)
postcss.config.js        # PostCSS 插件設定檔 (tailwindcss + autoprefixer)
vite.config.js           # Vite 打包配置 (含 Service Worker 版本與 precachemanifest 注入外掛)
capacitor.config.json    # Capacitor 配置 (appId, webDir, androidScheme)
index.html               # 入口 HTML (零首屏第三方 CDN，Google SDK/QRCode/Chart.js 本地化與按需載入)
```

## 模組依賴

- `main.js` → 所有模組 (中心樞紐)，**動態 import** `@capacitor/app`
- `ledgerManager.js` → `dataService.js`, `utils.js`
- `rewardService.js` → `utils.js` (showToast), 動態 import `@capacitor-community/admob`
- `syncService.js` → `dataService.js` (按需載入 Google SDK)
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
| `amortizations` | `id` (autoIncrement) | 攤提計畫 (支援 upfront 與 periodic) |
| `ledgers` | `id` (autoIncrement) | 帳本 |
| `theme` | `id` | 主題 |
| `pluginState` | `id` | 外掛狀態 |
| `groupMeta` | `id` | 群組分帳元資料 |
| `credit_statements` | `id` (autoIncrement) | 信用卡帳單 |

## 程式碼慣例

- **語法**: 不使用分號 (no semicolons)，ES Module
- **縮排**: 4 個空格
- **命名**: camelCase（函數/變數）、PascalCase（class）、snake_case（資料庫欄位）
- **XSS 防護**: 使用者輸入嵌入 innerHTML 時必須使用 `escapeHTML()`（import from `utils.js`）
- **批次查詢**: 避免 N+1 查詢，使用 `getDebts()`、`getRecords()` 批次載入
- **無障礙**: Modal 使用 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`

## 關鍵設計決策

- **多帳本與共用架構 (Per-Device Sync)**:
    - 每個裝置維護自己獨立的 `sync_shared_devlog_<uuid>` 雲端變更日誌檔，避免共用單一檔案引發並行寫入覆蓋；裝置日誌寫入時同樣支援 ETag / If-Match 樂觀鎖與 412 衝突重試
    - **全量日誌保全與去重鍵無裁切 (C2 / N1 防護)**：雲端日誌全量保留變更歷史；共用 (`sync_shared_applied_keys`) 與個人 (`sync_personal_applied_keys`) 同步之本地去重鍵完全保留，不依時間 (100天) 進行窗口裁切，徹底杜絕日誌重播導致舊資料或已刪除紀錄幽靈復活
    - **ID 精準刪除取代時間戳清理，杜絕跨帳本競爭掉單 (C1 / N5 防護)**：各同步通道 (`pushChanges` 與 `pushSharedLedgerChanges`) 在成功附加至雲端後，使用 `deleteSyncLogsByIds` 依變更 ID 精準清除本機 sync_log，嚴格過濾非法鍵並回傳狀態；`performSync` 徹底廢除跨帳本 `Math.min(personalMaxTs, sharedMaxTs)` 時間戳清理，根除多帳本並行記帳時未推送變更遭永久誤刪的風險
    - **預設帳本防劫持雙防線 (C3 / N2 防護)**：`_applyAdd` 與 `_applyUpdate` 的 id:1 預設帳本分支皆嚴格阻絕共用帳本變更 (`!data.isShared && !options?.isShared && !localDefaultLedger.isShared`) 覆寫受邀者的本機個人預設帳本 #1，避免個人記帳資料遭共用帳本取代
    - **舊共用檔遷移擁有者 Fail-Closed 防偽與批次授權 (C4 / H1 / N4 防護)**：`_ensureSharedInfra` 嚴格限制僅有 Google Drive 舊共用檔擁有者具備建立 Manifest 的權限（查詢權限失敗或非擁有者一律 Fail-Closed 拋錯中止，防協作者搶先建立而在自己 Drive 成為偽擁有者）；擁有者建立 Manifest 時自動查詢所有舊檔協作者並批次授予 `writer` 權限
    - **伺服器端授權 Fail-Closed 信任錨點 (M1 防護)**：`isLedgerOwner` 當 Google Drive 權限查詢失敗或無法取得時，嚴格採用 Fail-Closed 回傳 `false`，絕不降級採信可被竄改的 Manifest JSON
    - **跨帳本資料注入過濾 (M2 / N3 防護)**：`pullSharedLedgerChanges`、`joinViaManifest` 與 `_applyAdd` 依 `targetUuid` / `ledgerUuid` 嚴格過濾屬於當前共用帳本的變更，防範惡意成員或混淆注入其他帳本資料或偽造帳本定義
    - **DevLog 讀取授權對齊 Drive 真實權限 (M3 防護)**：`_grantDevLogPermissions` 在授予其他成員對本機 DevLog 的 `reader` 唯讀權限前，主動向 Google Drive 驗證成員 email 是否確為 Manifest 檔案合法成員，防止偽造 member 取得日誌存取權
    - **黑名單設備與 Email 雙重封鎖 (M4 防護)**：`removeSharedUser` 移除成員時同時將 email 記錄進黑名單，阻止尚未加入過的該成員其他裝置重新註冊
    - **檔案搜尋 Fail-Closed (M5 防護)**：`_findFileInDrive` 遇到非 OK 之 HTTP 回應一律拋出例外中止，防止因暫時性錯誤誤判為檔案不存在而重複建立孤立檔案
    - **雲端 Manifest 404 自動優雅降級 (M6 防護)**：`_ensureSharedInfra` 偵測到雲端 Manifest 404 時，自動將本機帳本更新降級為個人帳本 (`isShared: false`)，避免重試阻塞
    - **依賴關係拓撲排序修正 (M7 防護)**：`applyRemoteChanges` 之 `topoOrder` 修正為 `debts` / `amortizations` 優先於 `records`，未知 store 排於末端，確保還款與分期關聯之紀錄能正確解析外鍵
    - **CORS 非阻塞 ETag 降級容錯 (L1 / L2 防護)**：`_downloadFileStrict` 在 CORS 環境未暴露 ETag 標頭時以 `etag: null` 優雅降級回傳，避免阻斷網頁版同步運作
    - 以 `EasyAccounting_SharedManifest_<uuid>.json` 記錄所有參與成員的 deviceId、email 與日誌檔 ID，寫入時使用 ETag / If-Match 樂觀鎖重試防競態，註冊失敗立即中斷防孤立成員
    - 加入與共用流程：邀請時自動對 manifest 與日誌檔授權，取消/移除成員時閉環撤銷 Google Drive 檔案權限
    - 帳本本體支援 `sharedManifestId` 與 `sharedFileId` 雙向相容推進與取消共用

## 測試結構

所有的單元測試位於 `tests/unit/` 目錄下：

- `creditInstallment.test.js` # 測試信用卡分期 (upfront 模式、轉帳對生成、額度釋放、末期差額與補跑快取同步)
- `dataServiceInit.test.js` # 測試 IndexedDB 初始化安全 (版本探測、VersionError 防護、blocked 偵測與持久化)
- `recordsList.test.js` # 測試明細紀錄列表、群組標頭排版/折疊展開、預設時間範圍設定與搜尋清空按鈕
- `addPagePanels.test.js` # 測試記帳頁面板獨立開啟、互斥關閉與空值安全防護
- `homePage.test.js` # 測試首頁群組結餘小工具 (未結清群組展示、切片與 XSS 防護)
- `amortization.test.js` # 測試折舊攤提分期邏輯
- `amortizationModal.test.js` # 測試攤提/分期新增編輯 Modal (含 upfront 編輯防護)
- `budgetManager.test.js` # 測試預算管理邏輯
- `categoryManager.test.js` # 測試分類管理邏輯 (含無參數調用與雙向合併)
- `changelog.test.js` # 測試更新日誌解析與渲染
- `themeManager.test.js` # 測試主題管理 (含深淺色多模式切換、舊設定遷移、prefers-color-scheme 監聽、HTML/SVG 消毒解析、SVGToString 轉義與 CSS 變數消毒)
- `aiService.test.js` # 測試 AI 端側記帳 (含語意守門校正 applySemanticGuardrail、口語支出解析與降級規則推論)
- `widgetHelper.test.js` # 測試 Android Widget 資料計算與貨幣格式化 (含行事曆資料提取)
- `calendarCashFlow.test.js` # 測試行事曆金流元件 (群組、繪製、跨月與 XSS 消毒)
- `comparisonReport.test.js` # 測試跨月比較報表計算與 CSV 匯出
- `statistics.test.js` # 測試統計分析頁面 (跨月比較、XSS 防護)
- `dataService.test.js` # 測試 IndexedDB 資料層 (含紀錄多層級排序 date/timestamp/id 與刪除帳本級聯清理)
- `syncService.test.js` # 測試雲端同步 (含 per-device 獨立日誌檔、manifest 註冊表、ETag 樂觀鎖、appliedKeys 去重與個人/共用雙軌全量保留、舊帳本防斷網遷移、reader 權限與撤銷對齊、原子性 checkedMap、ledgers 變更永久留存與 ledgerMeta 快照回退、ID 精準清理杜絕掉單、預設帳本防劫持雙防線、N1-N5 回歸測試)
- `ledgerManager.test.js` # 測試帳本管理 (含建立、切換、刪除、新舊共用加入/分享/取消與 Drive 權限撤銷、reader 權限指派、shareLedger/removeSharedUser 擁有者校驗、sync_shared_granted 快取清理、Drive 伺服器端 owner 權限優先採信與 Fail-Closed 判定)
- `tourManager.test.js` # 測試導覽功能 (歡迎 Modal、氣泡導覽、自動實操演示、狀態持久化與取消中斷)
- ...等等（共有 38 個測試檔案，1651 項測試全部通過）
- 透過 `npm test` (`npx vitest run`) 執行所有單元測試


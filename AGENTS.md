# 輕鬆記帳 - 專案結構

```
src/js/
├── main.js              # 主應用程式 (EasyAccountingApp 類別，路由、頁面渲染、帳本切換器、processAmortizations, updateNavAddIcon)
├── themeManager.js      # 主題管理 (深淺色模式四態切換 system/light/dark/custom、prefers-color-scheme 動態監聽、meta theme-color 同步、套用 CSS 變數、圖示替換；SVG/CSS 注入消毒)
├── aiService.js         # PWA 離線 AI 記帳服務 (wllama WASM + 58M GGUF 推論引擎，含語意守門校正 applySemanticGuardrail、對齊訓練集 Prompt 格式、無痛換模防錯、HEAD ETag 版次檢驗與即時 Token 串流)
├── dataService.js       # IndexedDB 資料存取層 (Schema v15: 多帳本 + 攤提/分期 + 信用卡支援 + 群組分帳與單筆個別還款)
├── ledgerManager.js     # 帳本管理商業邏輯 (建立、切換、刪除、共用邀請/移除、Drive 權限撤銷)
├── groupManager.js      # 群組分帳管理商業邏輯 (建立、刪除群組、一鍵結清與單筆明細個別還款 settleGroupRecord)
├── categories.js        # 分類常數與工具函數
├── categoryManager.js   # 分類管理 UI 邏輯
├── statistics.js        # 統計分析頁面 (包含跨月比較報表等功能)
├── comparisonReport.js   # 跨月比較報表與 CSV 匯出 (包含結構比例、日均支出、儲蓄率)
├── calendarCashFlow.js   # 行事曆金流檢視 (月曆網格、Top 3 支出標籤、每日明細 Modal)
├── recordsList.js       # 記帳紀錄列表
├── budgetManager.js     # 預算管理
├── quickSelectManager.js# 快速選擇管理
├── debtManager.js       # 欠款與群組管理 (欠款/借貸、聯絡人篩選與關聯群組過濾、群組分帳 AA 帳)
├── changelog.js         # 更新日誌
├── datePickerModal.js   # 日期選擇器彈窗
├── pluginManager.js     # 擴充功能系統
├── pluginStorage.js     # 插件沙箱化儲存
├── syncService.js       # Google Drive 雲端備份&同步 (Per-Device 獨立日誌共用帳本同步與 Manifest 架構)
├── rewardService.js     # 雙平台廣告服務 (Capacitor AdMob + Web AdSense)
├── tourManager.js       # 導覽功能核心引擎 (GuideManager 類別，歡迎 Modal、氣泡引導、自動實操演示、狀態持久化)
├── tours/               # 導覽定義模組目錄 (包含各功能獨立導覽設定檔與統一註冊表 index.js)
├── router.js            # 路由管理
├── widgetHelper.js      # Android Widget 資料計算與同步輔助 (含行事曆 Widget 資料提取)
└── utils.js             # 共用工具函數 (格式化、Toast 等)

src/js/pages/
├── homePage.js          # 首頁：收支摘要、小工具、快速記帳
├── addPage.js           # 新增/編輯紀錄：金額輸入、分類選擇、群組、欠款、攤提
├── recordsPage.js       # 明細列表：篩選、搜尋、日期範圍、分頁
├── statsPage.js         # 統計報表：圖表、類別分析、趨勢
├── settingsPage.js      # 設定：主題、進階模式、匯入匯出、通知
├── accountsPage.js      # 帳戶管理：建立、編輯、刪除帳戶
├── debtsPage.js         # 欠款管理頁面
├── groupsPage.js        # 獨立群組與專案管理頁面
├── contactsPage.js      # 聯絡人管理
├── ledgersPage.js       # 帳本管理頁面 (新增/編輯/刪除/切換帳本，含圖示搜尋與自訂顏色、共用代碼)
├── amortizationsPage.js # 攤提/折舊/分期管理頁面 (新增/編輯/刪除，進度追蹤，首付+利息計算)
└── ...                  # 其他頁面

src/css/
└── main.css             # 主樣式表

android/                 # Capacitor Android 原生專案
├── app/src/main/
│   └── AndroidManifest.xml  # 含 AdMob App ID
└── variables.gradle     # SDK 版本設定 (minSdk=23, targetSdk=35)

capacitor.config.json    # Capacitor 配置 (appId, webDir, androidScheme)
index.html               # 入口 HTML (零首屏第三方 CDN，Google SDK/QRCode/Chart.js 按需載入)
```

## 模組依賴

- `main.js` → 所有模組 (中心樞紐)，**動態 import** `@capacitor/app`
- `ledgerManager.js` → `dataService.js`, `utils.js`
- `rewardService.js` → `utils.js` (showToast), **動態 import** `@capacitor-community/admob`
- `syncService.js` → `dataService.js` (按需載入 Google SDK)
- `pluginManager.js` → `dataService.js`, `pluginStorage.js`

## 關鍵設計決策

- **多帳本與共用架構 (Per-Device Sync & Manifest 架構)**:
    - **Per-Device 獨立日誌 (Append-Only)**：每個裝置維護自己獨立的 `sync_shared_devlog_<uuid>` 雲端變更日誌檔，避免多人同時記帳引發並行寫入覆蓋（Last-Write-Wins）；寫入時支援 ETag / If-Match 樂觀鎖與 412 衝突重試。
    - **Manifest 成員清單與 CAS 樂觀鎖**：以 `EasyAccounting_SharedManifest_<uuid>.json` 記錄成員 deviceId、email 與日誌檔 ID，寫入時使用 ETag / If-Match CAS 重試防競態，註冊失敗立即中斷防孤立成員。
    - **Google Drive 權限安全閉環**：邀請成員時自動補授權 Manifest 與個人 DevLog（`reader` 唯讀）；移除成員時同步撤銷 Google Drive 檔案權限，並維護黑名單。受限於 Drive 跨帳號限制，對等成員日誌權限透過「去中心化成員日誌權限最終一致性對齊機制（Peer Revocation Protocol）」精準撤銷。
    - **全量日誌保全與本地 appliedKeys 去重**：雲端日誌全量保留變更歷史；共用 (`sync_shared_applied_keys`) 與個人 (`sync_personal_applied_keys`) 同步之本地去重鍵完全保留無過期裁切，徹底解決跨時區/時鐘偏差與日誌重播導致的已刪除記錄幽靈復活。
    - **ID 精準刪除 (deleteSyncLogsByIds)**：各同步通道在成功附加至雲端後，依變更 ID 精準清除本機 `sync_log`，廢除時間戳清理，杜絕跨帳本未推送變更遭誤刪。
    - **預設帳本防劫持**：`_applyAdd` 與 `_applyUpdate` 的 id:1 預設帳本分支嚴格阻絕共用帳本變更覆寫受邀者的本機個人預設帳本 #1。
    - **衍生運算與進度隔離**：信用卡帳單 (`credit_statements`) 屬本地依明細即時衍生計算產物，明示跳過雲端同步，避免雙裝置同窗生成導致重複帳單；`processAmortizations` 自動推進期數時帶有 `skipLog = true`，防止快照回退造成進度倒退與重複扣款。
    - **外鍵解析與拓撲排序**：`applyRemoteChanges` 採用 `topoOrder` 先套用 debts / amortizations 再套用 records，確保關聯外鍵正確解析。
    - **身分與角色安全 (Fail-Closed)**：伺服器端 Google Drive 權限優先採信（`OWNER_ROLES = new Set(['owner', 'organizer'])`，支援 Shared Drive 組織者），查詢失敗一律 Fail-Closed 拒絕，不降級採信可被竄改之 Manifest。
- **多帳本架構 (Schema v15)**:
    - `ledgers` object store 儲存帳本元資料 (名稱、圖示、顏色、類型、uuid)
    - 所有資料 store (records, accounts, contacts, debts, recurring_transactions, amortizations, groupMeta) 支援 `ledgerId` index
    - 所有 CRUD 操作透過 `DataService.activeLedgerId` 自動過濾，傳入 `{ allLedgers: true }` 可跳過過濾
    - **同步與備份**:
        - 使用 `uuid` 作為跨裝置實體關聯的唯一標識，解決 `ledgerId` (Auto-increment PK) 在不同裝置不一致的問題
        - 匯出/匯入支援「全帳本打包」，匯入時自動建立 ID 映射 (Remapping) 並關聯至正確帳本
- **攤提/折舊/分期 (amortizations)**:
    - 統一模型：分期付款 / 折舊 / 攤提 均使用 `amortizations` store，以 `type` 欄位區分
    - 支援首付 (`downPayment`) 與年金利率計算 (`interestRate`)
    - `processAmortizations()` 在 `main.js` init 時自動觸發：到期且 `status=active` 的項目自動生成記帳紀錄
    - 自動生成的紀錄帶有 `amortizationId` 欄位，可追溯至所屬的分期計畫
    - 到達總期數後自動標記 `status=completed`
    - 入口位於設定頁「攤提/分期管理」（獨立功能，不需開啟多帳戶模式）
    - 新增紀錄頁可透過內嵌面板（類似欠款面板）快速建立分期計畫
    - **設計決策**：addPage 啟用分期時，只建立計畫不建立全額記帳紀錄；每期紀錄由 `processAmortizations()` 自動生成
- **週期性交易 & 攤提/分期 為獨立功能**，不綁定多帳戶模式開關；帳戶選擇器僅在多帳戶模式啟用時顯示
- **rewardService.js（雙平台）**: 模組載入時偵測 `Capacitor.isNativePlatform()`：
    - **原生** → 動態 import `@capacitor-community/admob`，使用 AdMob SDK 的 Banner 和 Rewarded Video
    - **Web** → 保留 AdSense 橫幅 + GPT 獎勵廣告 + 內建推廣廣告備案
    - 24 小時無廣告狀態存於 `localStorage`
- **主題系統與深淺色模式 (themeManager.js)**:
    - 支援四態外觀模式 (`THEME_MODES`: `system` 跟隨系統, `light` 淺色, `dark` 深色, `custom` 自訂主題)，預設採用 `system`
    - 透過 `window.matchMedia('(prefers-color-scheme: dark)')` 實作系統色彩偏好即時動態監聽
    - 自動同步更新 `<meta name="theme-color">` 保持手機狀態列/標題列色彩一體化
    - 具備舊版 `activeThemeId` 平滑遷移機制（Legacy Migration）並提供完整 `destroy()` 監聽器清理防記憶體洩漏
- **端側 AI 語意記帳 (aiService.js)**:
    - 整合端側 58M LLM (WASM/wllama) 離線推論、OPFS 快取與規則引擎降級
    - 具備 `applySemanticGuardrail()` 前端語意守門校準，防止小模型因幻覺將「花了/買了/付了」消費口語誤判為收入
    - 支援跨收支重疊分類（如「其他」）防呆驗證與 `CategoryManager.getAllCategories()` 無參數調用
- **Capacitor Android**: Web 資產打包進 `android/app/src/main/assets/public/`，透過 WebView 載入本地檔案，AdMob 為原生 overlay

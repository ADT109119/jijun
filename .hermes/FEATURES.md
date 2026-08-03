# 輕鬆記帳 (jijun) — 功能追蹤

## 專案資訊
- **GitHub**: https://github.com/ADT109119/jijun
- **當前版本**: v2.1.7.1
- **技術棧**: Vanilla JS + IndexedDB (idb) + Vite + Vitest + Playwright + Capacitor Android
- **CSS**: Tailwind CDN + FontAwesome + Chart.js
- **Schema**: IndexedDB v13 (信用卡支援)

---

## 已完成的功能

### Bug 修復
- ✅ #B01 多帳本類別同步漏洞 (2026-05-27) — 分類設定改為 per-ledger 儲存
- ✅ #B02 硬編碼 Google 憑證漏洞 (2026-05-28)
- ✅ #B03 XSS 漏洞 Quick Select (2026-06-02)
- ✅ #B04 hexToRgbTriplet null 輸入崩潰 (2026-06-05) — 主題管理器的 hex 轉換未檢查 null 輸入

### Issue 相關
- ✅ #40 首頁欠款總額 — Debt Summary Widget 已實作 (2026-05-27)
- ✅ #U06 分帳插件非平分模式 + 剩餘金額即時顯示 (2026-05-27)

### 已實作的核心功能
- ✅ 多帳本架構 (Schema v11/v12)
- ✅ 攤提/分期系統 (amortizations)
- ✅ 分類排序與隱藏 (SortableJS)
- ✅ 分類預算 (Per-Category Budget)
- ✅ 週期性交易
- ✅ 欠款管理
- ✅ 深色模式與主題商店
- ✅ 擴充功能系統 (Plugin System)
- ✅ Google Drive 雲端備份&同步
- ✅ 共用帳本
- ✅ 多帳戶模式
- ✅ 每日定時提醒
- ✅ 明細搜尋
- ✅ 帳戶餘額調整
- ✅ 首頁小工具排序
- ✅ 設定頁 GitHub Star 數動態顯示 (2026-06-03)
- ✅ 行事曆金流檢視 (2026-07-23) — Google Calendar 風格，Google Calendar 風格月曆 + 金流顯示 + Android Widget

---

## 待開發

### 高優先級 (P1)
- [x] **#U07 跨月比較報表功能** — 支援跨月份/跨年度的收支比較報表 (參考 MOZE 4.0 比較報表) — ✅ 四個階段全部完成 (2026-06-21 完成第四階段，2026-06-23 Code Review 確認所有改善項已修復)
- [ ] **#U02 純自架後端雲端備份** — 不依賴 Google Drive，提供自架後端作為備份/同步目標
- [ ] **#U03 多幣種帳戶支援** — 每個帳戶可設定獨立幣別，支援即時匯率換算與顯示 ⏳ 規劃中 (PLAN-U03-MULTI-CURRENCY.md, v2.2.x, Schema v14)
- [ ] **#P01 週期性交易跨裝置同步問題** — 多裝置修改/刪除週期性交易時會互相覆蓋設定，導致重複紀錄和大量自動記帳記錄（需調查 recurring_transactions 的 UUID 同步機制與衝突處理）

### 中優先級 (P2)
- ✅ **#U04 信用卡特別帳戶** — 信用卡帳單日、循環信用、分期還款等信用卡專屬功能 (2026-06-28 v2.1.5.7)
- ✅ **信用卡基礎資料層 (Schema v13)** — dataService.js 已實作 credit_statements store、信用卡帳戶欄位、帳單計算與自動產生 (2026-06-11)
- ✅ **信用卡 FIFO 繳款沖銷** — 轉帳繳卡費/還款入帳時自動由舊到新沖銷未繳帳單 (2026-06-28)
- ✅ **信用卡自動扣繳** — 支援綁定一般帳戶自動轉帳還卡 (2026-06-28)
- [ ] **#14-2 分期付款整合攤提/折舊** — 專案已有 amortizations 功能，需確認是否已完整涵蓋 Issue #14 的分期付款需求
- ✅ **#14-3 信用卡帳戶** — 信用卡專屬帳戶類型 (帳單日、免息期、循環利率) (2026-06-28 v2.1.5.7)
- [ ] **#9 UI 改動建議** — 包含：分類介面優化、鍵盤摺疊、貓咪主題等 (需逐項確認)

### 低優先級 (P3)
- [ ] **#U05 更多顏色主題** — 擴充預設主題數量 (目前已有 Ocean Blue、Cyberpunk、Matrix、Sakura 等)
- [ ] **#8 疑問與建議** — 包含：匯出 PDF 報表、遊戲化存錢、AI 預測性理財、AI 掃描發票、Edge/Capacitor Widget 等 (需逐項確認)

---

## Issue #46 追蹤
- **標題**: 收入項目裡的 [欠款回收]
- **回報者**: yabo-tw (2026-06-11)
- **問題**: 使用 [收入][欠款回收] 紀錄還款時，首頁本月統計不更新
- **owner 回應**: 此為特別設計，欠款回收不會被計入統計中
- **使用者 workaround**: 新增 [收入][欠款回收2] 來用於需要列入統計的場景

## 網路調研收集的功能

### 來自 GitHub Issues 的功能需求
- **匯出 PDF 報表** — 將記帳資料導出為 PDF 格式報表 (Issue #8)
- **遊戲化存錢** — 存錢罐/目標儲蓄視覺化，讓記帳過程更有動機 (Issue #8)
- **AI 預測性理財** — 使用者自行填入 OpenAI/Gemini API Key，基於歷史消費預測未來支出、預警超支風險 (Issue #8)
- **AI 掃描發票** — 使用者自行填入 OpenAI/Gemini API Key，拍照/上傳發票自動解析並記帳 (Issue #8)
- **Edge 桌面 Widget + Capacitor Widget** — Edge Web Widget (Web Application Manifest + Web Widget API)，並確保 Capacitor 打包時可被 Android 原生 Widget 橋接 (Issue #8)
- **行事曆檢視功能** — 將記帳日期與行事曆介面結合，每日記帳紀錄直接呈現在行事曆上 (Issue #48)
- **金額輸入小算盤** — 整合簡易運算功能，多筆消費可直接在輸入框內運算 (Issue #48)
- **大眾運輸票價與里程試算** — 台鐵/高鐵起訖地點自動帶入票價、自行開車里程計算 (Issue #48)

### 來自競爭對手與開源專案的靈感
- AI 消費模式分析與建議 (Ignidash 方向)
- 自動化規則引擎 (Advanced Rules) — 依據條件自動產生記帳紀錄
- 帳戶淨值趨勢圖 — 多帳戶資產負債一覽
- 匯入 OFX/QIF 檔 — 支援銀行匯出格式
- 半自動平衡功能 — 自動偵測並提示不平帳的帳戶
- Local-First 架構強化 — 離線優先、資料主權
- BeeCount (2026-06-08 調研) — 自建雲端 + iCloud/WebDAV/S3 同步、AI 記帳 (MCP)、Flutter 跨端
- 存錢罐/目標儲蓄視覺化 — Daak 記帳等 App 內建「許願」功能，讓存錢有目標感
- MOZE 4.0 (2026/5/25 更新) — 捷徑記帳增加幣種選項、通知中心支援多筆完成提醒入帳、比較報表功能
- MOZE v4.1.25 (2026/6/15 更新) — iOS 26.0/26.0.1 相容性修補；比較報表變化率顯示優化
- MOZE v4.1.27+ (2026/6/30+) — 比較報表新增 MoM Δ / YoY Δ 絕對差額欄位；交易明細預覽統計面板 (平均、中位數、最高/最低)；搜尋支援輸入幣種篩選
|- MOZE v4.2.1 (2026/7/23 更新) — FIX: 圖片記帳/發票歸帳多類別子項目備註; IMPROVE: 圖表讀取速度
|- MOZE 比較報表詳情 — 多維度表格分析，可交叉比對分類×時間段，支援變化率顯示
|- MOZE iPad 版 — 大螢幕重新設計，跨裝置即時同步
|- MOZE v4.1.28+ (2026/7/8 更新) — iOS 26.0/26.0.1 相容性修補、年度週期事件建立修復、明細報表折線圖餘額調整正負區分
- Firefly III v6.6.6 (2026-07-10 開發版) — 持續翻譯和修補更新
- Actual Budget (2026-07 更新) — 多 dashboard 頁面、自訂主題、可設定平均範圍的月度支出報表、標籤顯示/隱藏支援
- Actual Budget (2026-06-22 調研) — 2026 Roadmap: OIDC/multi-user、多新報表類型、schedules 可調時框、NPM sync package、年度預算差異報表
- MOZE 定價趨勢 — 2026/1/1 起專業版訂閱價格上調，4.0 功能期免費延長至 2025/12/31
- Akaunting (2026-06-14 調研) — 開源帳務軟體，支援發票、多帳本、雲端同步
- Percento (2026-06-14 調研) — Apple 原生極簡風格、多貨幣、股價自動追蹤
- 日常記帳 (2026-06-14 調研) — 個人+企業雙模式、固定支出自動記帳、多帳本
- Akaunting/Wave/Xero (2026-06-14 調研) — 中小企業帳務 SaaS，自動發票、即時現金流追蹤、複式記帳
- ezBookkeeping (2026-06-15 調研) — 開源自架記帳，Vue3 + Node.js，對比 Firefly III / Actual Budget，支援多帳本、預算追蹤、CSV 匯入
- Actual Budget 26.2.0/26.3.0 (2026-06-25 調研) — 多 dashboard 頁面、自訂主題穩定版、Budget Analysis 報表、主題圖表樣式化、高對比亮色主題
- Firefly III v6.6.2 (2026-06-25 調研) — 最新穩定版，OAuth 2FA 修復、webhook 支援、交易 ID 搜尋、LDAP OAuth 設定
- Issue #49 功能收集 (yanggu0413, 2026-06-27) — PWA 載入骨架畫面、計算機式鍵盤
- Firefly III v6.6.3 (2026-07-01 調研) — 最新穩定版，持續的翻譯和修補更新
- 標準化 CSV 範本與轉換器 — 做一個簡單的工具，讓想從其他主流 App 跳槽過來的用戶，可以一鍵把舊資料匯入 jijun
- Firefly III 規則引擎 (Rule Engine) — 允許使用者自訂自動化規則（例：交易名稱包含 "Uber" 自動歸類至「交通」並貼上「通勤」標籤）
- Firefly III 多樣化圖表 — 除了基礎圓餅圖，提供資產淨值走勢圖、歷史消費預測、預算達成率追蹤等視覺化分析
- AI 理財趨勢 (2026-07-01 調研) — 2026 年記帳App趨勢：AI 自動化同步銀行、電子發票、預測性理財功能成熟化
- Finch AI Bookkeeping (2026-07-02 調研) — 結合 AI 記帳、多帳本支援、智能支出分析，主打 AI-powered bookkeeping 自動化
- Moneybook (2026/7/1) — 發布聲明指控第三方冒用名義散布不實內容，已向警方報案
- 叮咚AI記帳 (2026-08-01 調研) — 多模態大模型智能記帳，支援語音、拍照識圖、iOS 快捷指令自動化、智能歸類
- Indexia 2026 記帳App推薦 — CWMoney（發票自動記帳+條碼）、記帳城市（遊戲化養成）、天天記帳（多帳本+iCloud/Google Drive）
- Actual Budget 26.6.0 (2026-08 更新) — Balance Forecast Report, Enable Banking sync provider, NZ bank sync via Akahu, 標籤顯示/隱藏支援

---

## 2026 上半年市場趨勢筆記
- **AI Agent 化** — 記帳 App 開始整合 AI Agent，自動解析消費情境、提供理財建議
- **Local-First 趨勢** — 使用者越來越重視資料隱私，偏好離線優先、本地存儲的 App
- **開源記帳生態** — actual-budget、firefly-iii、go-billing 等開源專案功能競爭激烈
- **AI 推理成本下降** — DeepSeek 等模型價格大幅下降，使 App 端整合 AI 功能變得可行

---

## 暫不實作
- ❌ 子分類 (Issue #14) — 介面設計困難，收益有限
- ❌ 鍵盤改版 (Issue #9) — 大金額場景難設計，現有鍵盤已足够好用

---

## Open Issues 狀態

| Issue | 標題 | 狀態 | 備註 |
|-------|------|------|------|
| #53 | IOS介面錯誤回報 (Lucas-Weii) | Closed ✅ (2026-07-30) | iOS 靈動島遮擋問題已修復 (commit e62d8f3)，使用者 2026-07-29 測試確認修復 |
| #46 | 收入項目裡的 [欠款回收] (yabo-tw) | Closed ✅ (2026-06-12) | 特別設計非 bug，使用者已找到 workaround |
| #51 | 擴充功能：小工具深色模式問題 (Maiagaru) | Closed ✅ (2026-07-09) | v2.1.6.2 已修復 (commit 9fa42d7) |
| #49 | 手機 PWA 載入速度優化 (yanggu0413) | Closed ✅ (2026-07-25) | 骨架畫面 ✅ + 計算機式鍵盤 ✅，Owner 已關閉 |
| #48 | 優化記帳輸入體驗、行事曆檢視、交通票價試算 (Lucas-Weii) | Open | 行事曆金流檢視 ✅ 已實作；小算盤 ✅ 已實作；大眾運輸票價試算 ❌ 尚未實作 |
| #14 | 建議功能 (isaswa) | Open | 多幣種 ✅ 已排程 #U03、分期 ✅ 已涵蓋 (amortizations)、信用卡資料層 ✅ Schema v13 |
| #9 | UI 改動建議 (hyaoang) | Open | 分類排序 ✅ 已實作、問號圖示 ⏳ 排程中、鍵盤改版 ❌ 暫不修改 |
| #8 | 疑問與建議 (Maiagaru) | Open | 分類預算 ✅ 已實作、手機鍵盤 UX ⏳ 排程 #U01、PDF/AI 等功能 💡 已列入調研 |

---

## 更新歷史

- **2026-08-03**: fix: dataService.js getRecords sorting (date desc → timestamp desc → id desc multi-level) + sync merge conflict resolution + 16 failing tests fixed (changelog.test.js: UPDATED_VERSIONS, renderVersionInfo UI assertions, loose it() blocks wrapped in describe, changelogManager→manager; groups.test.js: recordIds order; dataService.test.js: sort order); fix: changelog.test.js EXPECTED_VERSIONS 新增 v2.1.6.7~v2.1.7.1；fix: changelog renderVersionInfo tests 匹配 v2.1.7.0 UI redesign (當前版本/新功能/改進與優化/amber CSS)；fix: dataService.getRecordsFromLocalStorage 也套用多層級排序；1126 tests 全過 (原 1122, -6 from merge)；ESLint 修改檔案 0 errors；GitHub: 79 stars, 4 open issues (#48/#14/#9/#8) 無變化；遠端 owner 發布 v2.1.7.0 (wllama 端側 LLM) + v2.1.7.1 (明細搜尋清空+主題SVG優化)
- **2026-08-02**: Code Review + fix pluginStorage.js — 審查 pluginStorage.js (216行) 插件沙箱儲存；發現 2 HIGH (**H01: _saveToDB pluginData 不存在時靜默跳過導致首次寫入資料遺失、H02: 缺少 flush() 方法，頁面關閉/debounce 未觸發時緩衝區資料遺失**)、3 MEDIUM (M01: _saveToDB 即使 DB 失敗仍 resolve Promise 掩蓋錯誤、M02: init() 遍歷全部 localStorage keys O(n) 效能浪費、M03: 沒有 destroy() 清理 pending timeouts)、1 LOW (L01: 缺少 destroy 方法)；已修復 H01 (pluginData 不存在時自動建立紀錄) + H02 (新增 flush() 同步寫入方法) + L01 (新增 destroy() 清理資源)；新增 6 個單元測試 (flush 直接寫入/清除 timer/pluginData 不存在時建立/DB 失敗拋錯 + destroy flush 後清理/空 cache 不 flush)；1101 tests 全過 (原 1095 +6)；ESLint 0 errors (修復 categories.js eqeqeq)；安全評分 7→8/10；GitHub: 79 stars, 4 open issues (#48/#14/#9/#8) 無變化；市場：Actual Budget 26.6.0 (Balance Forecast Report, Enable Banking sync, NZ bank sync)；叮咚AI記帳多模態大模型智能記帳趨勢
- **2026-08-01**: Code Review changelog.js (1,090 行) — 發現 0 HIGH、2 MEDIUM (M01: getCurrentVersionInfo 版本不存在時回傳 undefined、M02: showChangelogModal 缺少 Escape 鍵關閉)、4 LOW (L01: renderCurrentVersionSummary 硬編碼顏色、L02: 殘留事件監聽器、L03: 缺少 destroy 方法、L04: CHANGELOG 資料無自動驗證)；已修復 M02 (Escape 鍵無障礙支援) + 新增 4 個單元測試；1095 tests 全過 (原 1091 +4)；ESLint 乾淨；安全評分 8/10；GitHub: 79 stars, 4 open issues (#48/#14/#9/#8) 無變化；MOZE 無 8 月新更新；市場趨勢：Moneybook 2026 全面收費後替代方案討論持續、開源記帳生態成長 (Actual Budget/Firefly III)、AI 記帳工具成熟化 (叮咚AI記帳)
- **2026-07-30**: fix(H01+H02) group management — H01: 統一 debtManager.js netAmount 定義為 `totalIncome - totalExpense` 以匹配 dataService.js（3處計算 + 7處比較邏輯翻轉）、H02: 修復 getGroups() dates.sort() in-place 副作用改為 `[...dates].sort()` ；commits 7e6a4f2 + b76448a；與 OpenCode 協作；927 tests 全過（2 datePickerModal pre-existing failures）；ESLint 乾淨
- **2026-07-30**: Code Review 群組管理系統 — 審查 groupManager.js (162行) + dataService.js (getGroups/settleGroup/partialSettleGroup) + debtManager.js (群組結清UI) + recordsList.js (group_settlement顯示)；發現 2 HIGH (**H01/H02 已修復** ✅)、4 MEDIUM (M01: partialSettleGroup 缺少金額驗證、M02: deleteGroup 未清除 records 的 groupId 導致孤兒關聯、M03: 淨額計算邏輯 5 處重複 DRY 違反、M04-RESOLVED: description XSS 經確認 recordsList.js L905 有 escapeHTML 防護)、3 LOW (L01: getGroupSummary 名稱與實作不符、L02: settleGroup 缺少 ledgerId 隔離驗證、L03: 缺少 destroy 方法)；產出 code-review-groupManager-2026-07-30.md；安全評分 7/10；927 tests 全過；GitHub: 79 stars, 4 open issues (#48/#14/#9/#8) 無變化
- **2026-07-30**: fix: group partial settlement — 群組部分結清時動態顯示「退款/收款」標籤（根據淨額方向判斷 isRefund），修正原本固定「退款」文案導致收款情境語意錯誤；commit 7701c40；854 tests 全過；GitHub: 79 stars, 5 open issues (#53/#48/#14/#9/#8) 無變化
- **2026-07-29**: Security fix debtManager.js — 修復 7 個 XSS 注入點 (H01: contact.name 在 debt card 列表 L462/L556 未 escapeHTML、H02: debt.description 在 debt card L472/L566、partial payment modal L901、settle modal L1006、payment history modal L1098、reminder message L1336/L1338 未 escapeHTML)；commit 7034eeb；854 tests 全過；ESLint 既有 2E/8W 不影響；GitHub: 79 stars, 5 open issues (#53/#48/#14/#9/#8) 無變化；MOZE 無 7 月新更新
- **2026-07-28**: Code Review recordsList.js — 發現 3 HIGH (H01: 全域缺少 escapeHTML 防護 description/account.name/category.name/statusLabel 直接嵌入 innerHTML、H02: 轉帳抵消邏輯未考慮跨帳本安全性、H03: 篩選彈窗 innerHTML 注入)、4 MEDIUM (M01: loadAndRenderRecords N+1 債務查詢、M02: updateSummary 死碼未使用、M03: 轉帳抵消邏輯 DRY 違反、M04: renderRecords 每次重新綁定事件監聽器)、4 LOW (日期推移強行 custom、硬編碼貨幣符號、搜尋邏輯可提取、缺少 aria-label 无障礙標籤)；產出 code-review-recordsList-2026-07-28.md；安全評分 5/10；832 tests 全過；GitHub: 79 stars (+1), 5 open issues (#53/#48/#14/#9/#8)；MOZE v4.2.1 (5天前: 圖表讀取速度優化、圖片記帳子項目備註修復)
- **2026-07-27**: 修復 comparisonReport CSV export 測試回歸 (3 tests) — `42fcfdd` commit 將 CSV header 改為中文輸出（期間類型、全部/僅支出），但測試仍期望英文 key；修正 3 個 assertion：`比較類型→期間類型`、`篩選類型,all→全部`、`篩選類型,expense→僅支出`；832 tests 全過；ESLint 乾淨；GitHub: 78 stars, 5 open issues (新增 #53 iOS 靈動島問題，commit 8b3317d 已修相同問題)
- **2026-07-26**: Code Review calendar cash flow redesign + Android widget (commit a657c98) — 發現 2H (catColor/catIcon XSS、records 檢查未用) / 4M (事件監聽器累積、N+1 getCategoryById、未用變數、渲染順序) / 3L (硬編碼 $、私有屬性、缺少鍵盤關閉)；已修復 H01 XSS 防護 (字元白名單消毒) + M03 移除 unused expenseSum + _formatShort 邊界保護；產出 code-review-calendar-widget-2026-07-26.md；832 tests 全過；ESLint 乾淨；GitHub: 78 stars, 4 open issues (#48/#14/#9/#8) 無變化
- **2026-07-25**: ESLint 修復 — `.eslintrc.json` 補上 `__WEB_STORE_URL__` global 定義 (Vite define 注入但 ESLint 未知導致 no-undef 錯誤)；src/js ESLint 錯誤數 1→0；826 tests 全過；GitHub: 78 stars, 4 open issues (#48/#14/#9/#8) 無變化
- **2026-07-24**: Code Review debtManager.js — 發現 2 HIGH (H01: renderContactsPage contact.name 未 escapeHTML XSS、H02: debt.description 多處未 escapeHTML XSS L354/L592/L682/L761/L895)、3 MEDIUM (M01: loadDebtList N+1 按鈕點擊重複查詢、M02: showContactSummaryModal contact.name 未 escapeHTML、M03: updateSummaryCards 每次全量載入無快取)、5 LOW (ESLint no-unused-vars、結清日期多餘 formatDateToString 轉換、缺少 destroy 方法、魔法數字 pageSize、document.execCommand 已淘汰)；產出 code-review-debtManager-2026-07-24.md；安全評分 7/10；826 tests 全過；GitHub: 78 stars, 4 open issues (#48/#14/#9/#8) 無變化；Moneybook 2026/7/1 報案第三方冒用
- **2026-07-23**: Code Review categoryManager.js — 發現 2 HIGH (icon innerHTML XSS 繞過 escapeHTML 防護、分類刪除 N+1 查詢效能瓶頸)、3 MEDIUM (SortableJS 實例未 destroy 記憶體洩漏 ESLint no-unused-vars 已確認、自訂顏色直接嵌入 CSS style 未消毒、分類 ID 產生 Date.now() 碰撞風險)、3 LOW (魔法數字、硬編碼圖示、缺少 destroy)；產出 code-review-categoryManager-2026-07-23.md；安全評分 6/10；826 tests 全過；GitHub: 78 stars, 4 open issues (#48/#14/#9/#8) 無變化；Moneybook 2026 全面收費後引發替代方案討論
- **2026-07-22**: Code Review owner hotfix (4eee2b3/0e58dde) — 欠款紀錄完整性修復功能審查：發現 2 HIGH (N+1 查詢效能瓶頸、非原子性修復資料不一致)、3 MEDIUM (非決定性帳戶選擇、重複掃描、recordUuid schema 未確認)、2 LOW (啟動延遲風險、缺少 destroy)；產出 code-review-debt-repair-2026-07-22.md；826 tests 全過；GitHub: 78 stars, 4 open issues (#48/#14/#9/#8)
- **2026-07-21**: 每日晨報 — GitHub: 78 stars, 4 open issues (#48/#14/#9/#8)；v2.1.6.5 已發布 (還款明細+雙向跳轉+帳務差額類別+聯絡人頭像備份)；826 tests 全過 (24 test files)；Git working tree clean； Issues 狀態無變化
- **2026-07-20**: 每日晨報 — GitHub: 78 stars, 4 open issues (#48/#14/#9/#8)；v2.1.6.5 已發布 (還款明細+雙向跳轉+帳務差額類別)；修復 main.js MAX_ITERATIONS import 遺漏 (ESLint no-undef, Code Review 7/9 M01)；826 tests 全過
- **2026-07-18**: 每日晨報 — GitHub: 78 stars, 5 open issues (#49/#48/#14/#9/#8)；#49 兩項核心需求（骨架畫面+計算機鍵盤）均已實作確認，建議關閉；昨晚 Code Review: ledgerManager.js (2H/3M/2L) + themeManager.js (1C/1H/3M/2L)；818 tests 全過
- **2026-07-17**: Code Review ledgerManager.js — 發現 2 HIGH (shareLedger 共用帳本初始化遺漏 amortizations/credit_statements 資料、dataService deleteLedger 串列刪除遺漏 credit_statements 導致孤兒資料殘留)、3 MEDIUM (changes 建構 DRY 違反是 H01 根因、switchLedger 死碼 fallback、joinSharedLedger 缺少外部資料結構驗證)、2 LOW (showToast XSS 已受 textContent 保護、deleteLedger 缺少結果回傳)；產出 code-review-ledgerManager-2026-07-17.md；H02 在 code-review-credit-card-2026-06-12.md 已有記錄但未修復；安全評分 5/10；818 tests 全過；ESLint 乾淨；GitHub: 78 stars, 5 open issues 無變化
- **2026-07-17**: Code Review themeManager.js — 發現 1 Critical (SVG innerHTML XSS: `template.innerHTML` 直接解析主題來源的 SVG 字串，惡意主題可注入 `<script>` 或事件處理器)、1 High (CSS 變數值未消毒: fallback 值直接嵌入 CSS 文字，可注入 `@import` 等惡意規則)、3 Medium (MutationObserver 全域效能開銷、深色主題檢測 `id.includes('dark')` 過於寬鬆、fetch dark.json 缺少超時/離線保護)、2 Low (luminance 重複 hex 解析邏輯、缺少 destroy 方法)；產出 code-review-themeManager-2026-07-17.md；安全評分 4/10 (SVG+CSS 注入未防護)；818 tests 全過；GitHub: 78 stars, 5 open issues 無變化；MOZE 最新版 v4.1.28 (2026/6/23 iOS 26 相容性 FIX)；Actual Budget 26.7.0 (銀行同步+CLI stable)；Firefly III v6.6.3 穩定版
- **2026-07-16**: Code Review widgetHelper.js — 發現 1 HIGH (categoryManager 參數未使用)、3 MEDIUM (每次頁面渲染觸發完整 Records 查詢效能瓶頸、loadBudget 重複 IO、硬編碼 $ 貨幣符號不支援多幣種 #U03)、2 LOW (無單元測試覆蓋、new Date() 重複實例化)；產出 code-review-widgetHelper-2026-07-16.md；791 tests 全過、ESLint 乾淨；GitHub: 78 stars, 5 open issues (#49/#48/#14/#9/#8) 無變化
- **2026-07-15**: Code Review statistics.js — 發現 2 HIGH (renderTopExpenses XSS: r.description 未 escapeHTML、帳戶餘額 N+1 查詢)、3 MEDIUM (Tailwind→Hex 顏色映射重複 DRY violation、趨勢圖硬編碼顏色不支援深色主題、熱力圖 toISOString UTC 時區偏移)、4 LOW (技術債註記、destroy 未清除事件監聽器、空值檢查、測試覆蓋不足)；產出 code-review-statistics-2026-07-15.md；791 tests 全過、ESLint 乾淨；GitHub: 78 stars, 5 open issues (#49/#48/#14/#9/#8) 無變化；Firefly III v6.6.3 穩定版；Actual Budget 26.7.0 穩定版
- **2026-07-15**: 每日晨報 — 791 tests 全過；Git working tree clean；GitHub: 78 stars, 5 open issues (#49/#48/#14/#9/#8)；#49 兩項核心需求（骨架畫面+計算機鍵盤）均已實作，建議關閉；#48 小算盤功能與 #49 計算機鍵盤為同功能
- **2026-07-12**: 新增 amortizationModal.js 單元測試；網路調研：Issue #51 已關閉（v2.1.6.2 修復），GitHub 剩 4 open issues (#49/#48/#14/#8)；MOZE v4.1.28 iOS 相容修補；Firefly III v6.6.6 開發版；Actual Budget 可設定平均範圍月度支出報表
- **2026-07-12**: Code Review main.js 改善 (M02/M03) — M02: processAmortizations N+1 查詢優化 (迴圈外 batch 載入 records 按 amortizationId 分組)；M03: updateSidebarLedger inline style 改為 CSS custom property (--ledger-color)；708 tests 全過、ESLint 乾淨
- **2026-07-12**: Code Review 回饋修復 (R01-R04) — R01: SW reload confirm 取消 refreshing 旗標重置；R02: color inline style hex 驗證；R03: 合併重複 import；R04: SW update toast 文字修正；708 tests 全過、ESLint 乾淨
- **2026-07-12**: Antigravity CLI code review 回饋 — icon regex XSS 修復 (\S+ 改為 fa-[a-zA-Z0-9-]+)；color regex 僅允許 3/4/6/8 位數 hex；708 tests 全過、ESLint 乾淨
- **2026-07-12**: 實作 PWA 骨架畫面 (Issue #49) — index.html 加入骨架 HTML（導航/結餘卡片/最近紀錄），內建 animate-pulse 動畫，dark mode 支援；JS 載入完成後由 innerHTML 自動取代；708 tests 全過、ESLint 乾淨
- **2026-07-09**: Code Review main.js — 發現 2 HIGH (PWA Share Target XSS 風險已確認下游有 escapeHTML、SW 自動重載可能丟失使用者資料)、4 MEDIUM (MAX_ITERATIONS 硬編碼、processAmortizations N+1 查詢、updateSidebarLedger inline style 主題不一致、showLedgerSwitcherPopup icon 未做 XSS 驗證)、4 LOW；修復 ESLint no-useless-escape 錯誤 ([\$￥]→[$￥])；產出 code-review-main-2026-07-09.md；708 tests 全過、ESLint 乾淨；GitHub: 78 stars, 5 open issues (#51/#49/#48/#14/#8) 無變化；#U07 跨月比較報表已完成
- **2026-07-08**: Code Review budgetManager.js — 發現 2 HIGH (NaN 污染預算計算、事件監聽器綁定方式)、4 MEDIUM (getCategoryById 重複呼叫、SortableJS 全量重建、localStorage 失敗未處理、排除類別未去重)、4 LOW (categoryBudgetOrder fallback 註解、checkBudgetWarning 可提取、水波動畫邊界、測試 mock key 欄位不一致)；產出 code-review-budgetManager-2026-07-08.md；703 tests 全過、ESLint 乾淨；GitHub: 78 stars, 6 open issues (#51/#49/#48/#14/#9/#8) 無變化；v2.1.6.2 owner commit 包含插件深色模式修復（#51）、多帳本同步隔離、PWA Widget 本地時區
- **2026-07-08**: v2.1.6.0 發布 (owner commit) — PWA 進階能力：防重複啟動、外部分享記帳、Windows 桌面小工具、Service Worker 強化、manifest.json 更新、新增 icon-512.png 與截圖；GitHub: 78 stars, 6 open issues (新增 #51 小工具深色模式問題)；703 tests 全過、ESLint 乾淨；昨日 Code Review pluginManager.js 產出報告 (2 HIGH, 4 MEDIUM, 4 LOW)
- **2026-07-07**: Code Review pluginManager.js — 發現 2 HIGH (importScripts 繞過沙盒、Blob URL 沙盒逃逸)、4 MEDIUM (腳本大小限制、getRecords 參數、Hook 數量限制、PluginStorage 清理)、4 LOW (版本比較 semver、權限邏輯簡化、屬性命名、z-index)；產出 code-review-pluginManager-2026-07-07.md；703 tests 全過、ESLint 乾淨；GitHub: 77 stars, 5 open issues (#49/#48/#14/#9/#8) 無變化；MOZE 比較報表新增 MoM Δ / YoY Δ 絕對差額欄位；網路調研無新 issue
- **2026-07-06**: 新增 recordsList.js 單元測試 (19 tests, 總計 703) — 涵蓋轉帳抵消、搜尋/類型過濾、日期推移、標題顯示、session 過濾器、欠款狀態顯示、欠款類別排除摘要；GitHub: 77 stars, 5 open issues (#49/#48/#14/#9/#8) 無變化
- **2026-07-04**: 新增 virtualKeyboardDetector.js 單元測試 (38 tests, 總計 676) — 涵蓋 constructor 設定、_setState 去重、Layer 2 Visual Viewport resize/orientation、Layer 3 Focus/Blur selector matching、destroy/cleanup；確認 code review 發現的 input[type="number"] 未支援問題；MOZE 最新版本 v4.1.27 (2026/6/30)、Actual Budget 26.7.0 (2026-07-01)、Firefly III v6.6.3；GitHub 77 stars, 5 open issues 無變化
- **2026-07-03**: Code Review notificationService.js + virtualKeyboardDetector.js + themeManager.js — 發現 2 HIGH (notification ID 硬編碼、MutationObserver 效能)、5 MEDIUM (SW 就緒檢查、orientation null guard、SVG sanitizer、dark.json schema、schedule 重覆排程)、8 LOW；產出 code-review-notification-virtualKeyboard-theme-2026-07-03.md；638 tests 全過、ESLint 乾淨；關鍵發現：virtualKeyboardDetector 未支援 input[type="number"] 可能影響金額輸入偵測；GitHub: 77 stars, 5 open issues (#49/#48/#14/#9/#8) 無變化
- **2026-07-02**: Code Review syncService.js + #P01 週期性交易同步調查 — 發現 1 HIGH (add 操作 UUID 碰撞可能產生重複)、3 MEDIUM (update/delete UUID fallback、init 順序、共用帳本推送)、2 LOW；產出 code-review-sync-service-2026-07-02.md；638 tests 全過、ESLint 乾淨；網路調研：2026 記帳App趨勢 AI 語音記帳成熟化(Finch/說說記帳)、Actual Budget/Firefly III 持續更新
- **2026-06-29**: 晨報 — GitHub Stars: 77、Issues: 5 open (#49/#48/#14/#9/#8)；v2.1.5.7 已發布 (信用卡智慧管理+FIFO 沖銷+自動扣繳+小鍵盤計算機模式)；#49 計算機鍵盤已實作，骨架畫面研究中；#14-3 信用卡帳戶已實作；FEATURES.md 更新 #U04/#14-3 狀態
- **2026-06-27**: 網路調研 — 新 Issue #49 (yanggu0413: 手機 PWA 載入速度優化，含 2-5 秒空白等待與骨架畫面建議、計算機式鍵盤)、GitHub Stars: 76、Issues: 5 open (#49/#48/#14/#9/#8)；產出 Code Review 報告；601 tests 全過、ESLint 乾淨
- **2026-06-26**: Code Review #U07 狀態確認 — 上次5項改善(MR-03/MR-04/LR-04/LR-01/LR-05)全部已修復；產出code-review-status-check-2026-06-26.md；更新FEATURES.md標記#U07四階段完成；601 tests全過、ESLint乾淨；剩2中風險(效能/測試)+3低風險建議可排入未來迭代
- **2026-06-25**: 網路調研 — 新 Issue #48 (Lucas-Weii: 行事曆檢視/小算盤/交通票價試算)、GitHub Stars 76、Firefly III v6.6.2、Actual Budget 26.3.0； FEATURES.md 新增 #48 功能收集、Open Issues 表格新增 #48；產出 code-review-comparison-report-2026-06-25.md；601 tests 全過、ESLint 乾淨
- **2026-06-23**: Code Review + 改善 #U07 跨月比較報表 — 圖表記憶體洩修復 (MR-03)、去年比較按鈕改為合併模式 (MR-04)、新增 loading 狀態指示 (LR-04)、提取 TREND_THRESHOLD 常數 (LR-01)、CSV 匯出新增 periodType (LR-05)；產出 code-review-comparison-report-2026-06-23.md；601 tests 全過、ESLint 乾淨
- **2026-06-22**: ESLint 錯誤修復 — 修復 pluginManager.js `pluginData` 未定義錯誤（改用 `pluginId`）、bill_splitter.plugin.js `splitContacts` let→const；更新 FEATURES.md：MOZE v4.1.25 調研、Actual Budget 2026 Roadmap 調研；#46 狀態更新為 Closed；#U07 功能完整性確認（四個階段全部完成，601 tests 全過）
- **2026-06-21**: #U07 跨月比較報表第四階段 — 日均支出比較（含天數校正、閏年處理）、分類排名比較（Top 5 排名+變動指示器🥇🥈🥉+新分類標記）；comparisonReport.js 新增 getDaysInPeriod、calculateDailyAverages、renderDailyAverages、renderCategoryRankings；comparisonPage.js renderResults 整合日均支出卡片與分類排名區塊；comparisonReport.test.js 新增 11 個測試（總計 601 tests）；ESLint 乾淨
- **2026-06-19**: #U07 跨月比較報表第二階段 — 收支類型過濾（全部/僅收入/僅支出）、與去年同月比較快捷按鈕、匯出 CSV 功能（含 UTF-8 BOM Excel 相容）；comparisonReport.js 新增 typeFilter 參數、getLastYearPeriods static method、exportToCSV method；comparisonPage.js 新增 type filter toggle、last-year button、CSV download；新增 comparisonReport.test.js (12 tests, 總計 572 tests)
- **2026-06-18**: #U07 跨月比較報表第一階段 — 整合_comparisonReport.js + comparisonPage.js_ 到路由系統 (#comparison)，統計頁新增入口按鈕；強化 UI（返回導航、使用說明、已選數量提示、FontAwesome 圖示、環比變化 badge）；Chart.js 圖表改用 formatCurrency 統一格式；comparisonReport.js 移除 accountId 參數、改由 DataService 自動帳本過濾；ESLint + 560 tests 全過
- **2026-06-17**: 小鍵盤虛擬鍵盤自動隱藏 (#U01 修正) — 新增 VirtualKeyboardDetector (3 層 fallback: VirtualKeyboard API → Visual Viewport API → Focus/Blur delegation)；進入新增紀錄頁時 keypad 預設顯示；手機虛擬鍵盤彈出時自動隱藏 keypad grid；虛擬鍵盤收起後自動恢復顯示；閾值 150px；iOS Safari blur 延遲 300ms 補償；orientationchange 時重置 baseline
- **2026-06-16**: 新增 datePickerModal.js 單元測試 (27 tests, 總計 560) — 覆蓋 DOM 結構/ARIA/快速日期按鈕/確定與取消按鈕/背景點擊關閉/CSS class；網路調研：GitHub 仍 3 open issues (#14, #9, #8)、2 open PRs (Weekly code quality + Sentinel XSS)；市場趨勢：CopilotKit × AG-UI × Next.js AI 記帳 App 開發範例、Percento 專注大額金額變動記帳
- **2026-06-14**: 信用卡功能修補 (Schema v13) — 修復 calculateCreditCardBalance 死碼 (else-if 永不會執行) + 效能優化 (改用 index 查詢替代全量載入)；修復 exportData/exportDataForSync/_exportFullBackup/importData 遺失 credit_statements (匯出/同步/備份/匯入資料遺失)；新增 importData 清除 credit_statements

- **2026-06-12**: Code Review 信用卡功能 (Schema v13) — 發現 12 項問題 (3 高/4 中/5 低)、ESLint 確認死碼錯誤 (no-dupe-else-if)；重點：calculateCreditCardBalance 效能問題 (全量載入 records)、exportData/exportDataForSync 缺少 credit_statements (資料遺失)、信用卡還款計算永遠錯誤 (M1 死碼)、信用卡餘額計算語義反轉；新增 code-review-credit-card-2026-06-12.md
- **2026-06-11**: 提交信用卡基礎資料層 (Schema v13, commit 2afbe51)；新增信用卡資料層單元測試 (30 tests)；網路調研：GitHub 新 issue #46 (欠款回收統計問題)、MOZE 4.0 新功能 (捷徑幣種/通知中心批量/比較報表)、GitHub Stars: 56
- **2026-06-10**: 新增 utils.js 單元測試 (47 tests: formatDate, getDateRange, getMonthRange, calculateNextDueDate, shouldSkipDate, calculateAmortizationDetails，總計 480)；網路調研：GitHub 仍為 3 open issues (#14, #9, #8)、2 open PRs、Pursenal 跨平台記帳 (Flutter+複式記帳)、Daak/Ahorro/Percento 等 2026 熱門記帳 App 趨勢
- **2026-06-09**: 新增 SyncService 單元測試 (34 tests, 總計 433)；網路調研：GitHub 仍為 3 open issues (#14, #9, #8)、ezBookkeeping/Firefly III/Actual Budget 功能對比調研、市場趨勢：個人理財 App 持續成長
- **2026-06-08**: 新增 QuickSelectManager 單元測試 (52 tests, 總計 399)；網路調研：GitHub 無新 issue (仍為 #14, #9, #8)、發現 BeeCount 開源記帳 (自建云+WebDAV/S3 同步+AI 記帳+MCP)、Moneybook 全面收費趨勢、開源記帳生態持續成長
- **2026-06-07**: 新增 Router 單元測試 (26 tests, 總計 347)；網路調研：GitHub 無新 issue/PR、競爭對手 Moneybook 導入 GPT-4o 財富顧問、Actual Budget 與 Firefly III 功能對比；市場趨勢：記帳 App 市場持續成長
- **2026-06-06**: 新增 notificationService 單元測試 (29 tests)、修復 pluginManager widget-to-plugin 對應 + pluginsPage 商店插件全顯示；GitHub 調研：3 open issues (#14, #9, #8)、1 open PR (Sentinel XSS fix)；市場趨勢：個人理財 App 市場 2026-2035 CAGR 20.57%、AI Agent 整合、Local-First 趨勢
- **2026-06-05**: Code Review dataService.js (2,524 行) — 發現 15 項問題 (2 高/6 中/7 低)、效能 N+1 查詢風險、匯入還原 ID 映射問題；新增 code-review-dataService-2026-06-05.md；市場調研：記帳 App 趨勢 (Moneybook 全面收費、AI 記帳、本地優先)
- **2026-06-04**: 重建 FEATURES.md (檔案意外遺失)、更新 GitHub Star 數功能已完成
- **2026-06-03**: GitHub Star 數動態顯示功能上線、Code Review 發現 XSS 潛在風險
- **2026-06-02**: Quick Select XSS 修復 (#B03)、單元測試 265 tests
- **2026-05-28**: 硬編碼憑證修復 (#B02)
- **2026-05-27**: 多帳本分類隔離 (#B01)、分帳插件非平分模式 (#U06)

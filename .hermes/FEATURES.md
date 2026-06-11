# 輕鬆記帳 (jijun) — 功能追蹤

## 專案資訊
- **GitHub**: https://github.com/ADT109119/jijun
- **當前版本**: v2.1.5.6
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

---

## 待開發

### 高優先級 (P1)
- [x] ~~#U01 小鍵盤自動縮起~~ — ✅ 已實作 (2026-06-05)：小鍵盤預設隱藏、點擊金額 $0 展開、圖示切換（鍵盤 ↔ 向上箭頭）
- [ ] **#U02 純自架後端雲端備份** — 不依賴 Google Drive，提供自架後端作為備份/同步目標
- [ ] **#U03 多幣種帳戶支援** — 每個帳戶可設定獨立幣別，支援即時匯率換算與顯示

### 中優先級 (P2)
- [ ] **#U04 信用卡特別帳戶** — 信用卡帳單日、循環信用、分期還款等信用卡專屬功能
- ✅ **信用卡基礎資料層 (Schema v13)** — dataService.js 已實作 credit_statements store、信用卡帳戶欄位、帳單計算與自動產生 (2026-06-11)
- [ ] **#14-2 分期付款整合攤提/折舊** — 專案已有 amortizations 功能，需確認是否已完整涵蓋 Issue #14 的分期付款需求
- [ ] **#14-3 信用卡帳戶** — 信用卡專屬帳戶類型 (帳單日、免息期、循環利率)
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
| #46 | 收入項目裡的 [欠款回收] (yabo-tw) | Open | 特別設計非 bug，使用者已找到 workaround |
| #14 | 建議功能 (isaswa) | Open | 多幣種 ✅ 已排程 #U03、分期 ✅ 已涵蓋 (amortizations)、信用卡資料層 ✅ Schema v13 |
| #9 | UI 改動建議 (hyaoang) | Open | 分類排序 ✅ 已實作、問號圖示 ⏳ 排程中、鍵盤改版 ❌ 暫不修改 |
| #8 | 疑問與建議 (Maiagaru) | Open | 分類預算 ✅ 已實作、手機鍵盤 UX ⏳ 排程 #U01、PDF/AI 等功能 💡 已列入調研 |

---

## 更新歷史

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

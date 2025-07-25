# 輕鬆記帳 2.0 - 更新日誌

## v2.0.7.3 (2024-07-19) - 日期功能優化與添加自訂日期快速設定

### 🐛 錯誤修復
- **修復早上8點前記帳日期錯誤顯示為前一天的問題**: 解決 `toISOString()` 時區轉換導致的日期錯誤

### 🔧 改進優化
- **統一日期處理**: 創建 `formatDateToString` 函數，統一處理日期格式化
- **自訂時間範圍使用體驗優化**: 新增自訂時間範圍快速設定按鍵，添加「今日」、「本週」、「近七日」、「本月」、「上月」、「今年」快速選擇

---

## v2.0.7.2 (2024-07-12) - 製作新的 icon

### 🔧 改進優化
- **製作新的 icon**: icon 改版，完全重新繪製

---

## v2.0.7.1 (2024-07-12) - 瀏覽器歷史記錄管理與設定介面修復

### ✨ 新功能
- **瀏覽器歷史記錄管理**: 新增完整的瀏覽器歷史記錄支援，解決 PWA 導航問題
- **手機返回鍵支援**: 支援手機返回鍵在應用內導航，不再直接退出程式
- **URL 同步**: URL 會同步顯示當前頁面狀態（#list, #add, #records, #stats）
- **瀏覽器導航**: 支援瀏覽器前進/後退按鈕操作

### 🐛 錯誤修復
- **設定介面修復**: 修復設定介面無法打開的問題，現在所有頁面都能正常訪問設定
- **事件監聽器修復**: 修復頁面切換時事件監聽器失效的問題
- **PWA 導航修復**: 解決 PWA 中返回鍵直接退出應用的問題

### 🔧 改進優化
- **事件委託優化**: 使用事件委託優化設定按鈕的事件處理，提升穩定性
- **PWA 體驗改善**: 改善 PWA 的使用體驗和導航流暢度
- **瀏覽器兼容性**: 增強應用程式的瀏覽器兼容性

---

## v2.0.7 (2024-07-12) - 使用體驗優化與功能完善

### ✨ 新功能
- **完整版本更新日誌系統**: 新增內建的版本管理系統，可查看所有歷史版本的詳細更新記錄
- **設定頁面整合**: 版本資訊與更新內容整合顯示，提供更好的版本資訊查看體驗
- **歷史版本查看**: 支援查看所有歷史版本的詳細更新記錄，包含新功能、錯誤修復和改進優化

### 🐛 錯誤修復
- **明細頁面編輯修復**: 修復編輯記錄時不會預設選擇原分類的問題，現在會自動選擇記錄的原始分類
- **首頁滑動衝突修復**: 修復首頁 slider 滑動衝突問題，現在可以正常在 slider 區域垂直滾動頁面
- **手勢識別改善**: 改善觸控手勢識別邏輯，避免誤觸發 slider 切換，提升使用體驗

### 🔧 改進優化
- **智能手勢檢測**: 優化 slider 手勢檢測邏輯，智能判斷滑動方向（水平/垂直），只在水平滑動時觸發 slider 切換
- **設定頁面優化**: 改善設定頁面版本資訊的顯示效果，整合版本號、發布日期和更新內容
- **編輯體驗增強**: 增強編輯記錄時的使用者體驗，保持原有設定減少重複操作

---

## v2.0.6.3 (2024-07-07) - 日期篩選修復與記帳頁面優化

### 🐛 錯誤修復
- 修復日期篩選錯誤顯示上個月月底記錄的問題
- 修正時間範圍計算的時區轉換問題
- 改用字符串直接比較避免 Date 對象時區影響

### 🔧 改進優化
- 調整記帳頁面 CSS 樣式
- 優化輸入區域布局和間距
- 改善整體視覺效果

---

## v2.0.6.2 (2024-07-06) - 記帳小鍵盤介面調整

### 🔧 改進優化
- 微調記帳頁面小鍵盤 CSS 樣式
- 優化按鈕大小和間距
- 改善觸控體驗

---

## v2.0.6.1 (2024-07-06) - 背景樣式優化

### 🔧 改進優化
- 調整應用程式背景 CSS
- 改善整體視覺配色方案
- 優化使用者介面美觀度

---

## v2.0.6 (2024-07-06) - 分類管理系統增強

### ✨ 新功能
- 添加自訂圖示功能，支援更多個性化選擇
- 分類名單設定頁面添加滾動功能
- 避免長列表被裁切的問題

### 🔧 改進優化
- 優化分類選擇介面
- 改善分類管理的使用體驗
- 增強分類設定的靈活性

---

## v2.0.5 (2024-07-06) - 記帳功能完善

### ✨ 新功能
- 記帳項目支援後續編輯分類功能
- 增強記錄管理的靈活性

### 🔧 改進優化
- 調整數字鍵盤大小，提升使用體驗
- 優化記帳介面布局
- 改善觸控操作感受

---

## v2.0.4.2 (2024-07-06) - 路徑修復

### 🐛 錯誤修復
- 修復部分檔案路徑錯誤
- 解決資源載入問題

---

## v2.0.4.1 (2024-07-06) - 版本號顯示修復

### 🐛 錯誤修復
- 修復版本號顯示錯誤的問題
- 確保版本資訊正確顯示

---

## v2.0.4 (2024-07-06) - 小鍵盤最小化與更新檢查

### ✨ 新功能
- 記帳頁面小鍵盤支援最小化功能
- 添加檢查更新按鈕
- 支援手動檢查應用程式更新

### 🔧 改進優化
- 優化記帳頁面空間利用
- 改善小螢幕使用體驗
- 增強應用程式更新機制

---

## v2.0.3 (2024-07-06) - Service Worker 版本管理

### ✨ 新功能
- 調整 Service Worker 支援版本號偵測
- 實現強制更新機制
- 添加版本更新通知功能

### 🔧 改進優化
- 優化應用程式更新流程
- 改善快取管理策略
- 增強離線功能穩定性

---

## v2.0.2 (2024-07-06) - 首頁滑動體驗優化

### ✨ 新功能
- 首頁 Slider 支援即時滑動跟隨
- 添加滑動手勢支援
- 實現流暢的頁面切換效果

### 🔧 改進優化
- 優化觸控操作體驗
- 改善頁面切換動畫
- 增強使用者互動感受

---

## v2.0.1 (2024-07-06) - 資料管理功能

### ✨ 新功能
- 添加資料上傳頁面
- 支援資料匯入匯出功能
- 實現資料備份與還原

### 🔧 改進優化
- 優化資料處理流程
- 改善檔案操作介面
- 增強資料安全性

---

## v2.0.0 (2024-07-02) - 全新版本發布

### ✨ 新功能
- 全新的現代化介面設計
- 響應式布局支援各種螢幕尺寸
- 底部導航系統
- 首頁統計儀表板
- 記帳明細列表頁面
- 統計分析功能

### 🔧 改進優化
- 使用 Tailwind CSS 重新設計
- 採用 ES6 模組化開發
- 優化載入速度和使用體驗

---

## v1.x (2024-06-30) - 舊版本功能

### ✨ 基礎功能
- 基礎記帳功能
- 簡單的資料儲存
- 基本的統計顯示

> **注意**: 舊版本已停止維護，建議升級到 2.0 版本

---

## 圖例說明

- ✨ **新功能**: 全新添加的功能特性
- 🐛 **錯誤修復**: 修復的問題和 Bug
- 🔧 **改進優化**: 現有功能的改善和優化
- ⚠️ **重要變更**: 可能影響使用方式的重要變更
- 📝 **文件更新**: 文件和說明的更新

---

*更多詳細的技術變更和開發資訊，請參考 [README.md](README.md)*
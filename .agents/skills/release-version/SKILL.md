---
name: release-version
description: >-
  Release workflow for 輕鬆記帳 (jijun). Use when the user asks to bump the version,
  prepare a release, or publish a new version ("發新版", "發布版本", "更新版本號",
  "release", "bump version"). Enforces 4-part X.Y.Z.W carry-at-10 versioning,
  changelog filtering rules, 3-file synchronization, conditional guide updates,
  and pre-release verification.
---

# 發新版工作流程（Release Version）

本專案採用自訂 4 位數版本號與多檔案同步的發版規範。執行「發新版」時請嚴格依照下列步驟辦理。

---

## 1. 盤點本次實質變更

1. 檢視自上一個版本標籤以來的新增提交與目前工作區異動：
   ```bash
   git log $(git describe --tags --abbrev=0)..HEAD --oneline
   git status --short
   ```
2. 篩選要寫入更新日誌的項目：
   - **只記實質變更**：僅收錄對使用者或系統有實質影響的新增功能、問題修復與體驗優化。
   - **中間 bug 不入帳**：開發過程中自己引入並在同一輪開發內修掉的 bug、測試調整、單純格式化或無實質行為改變的重構，一律不寫入 Changelog。
3. **強制前綴規範**：每筆條目皆須明確標註以下三種前綴之一：
   - `新功能:`（對應 `features` / `### ✨ 新功能`）
   - `修復:`（對應 `bugfixes` / `### 🐛 錯誤修復`）
   - `優化:`（對應 `improvements` / `### 🔧 改進與優化`）

---

## 2. 計算新版本號（4 位數 `X.Y.Z.W`）

1. 從 `package.json` 讀取目前的 `version` 欄位。
2. 嚴守 **4 位數 `X.Y.Z.W`（非標準 SemVer）** 遞增規則：
   - **預設僅將最後一位 `W` 加 1**。
   - **滿 10 進位到上一位**：`W` 達 10 時歸 0 並使 `Z + 1`；依此類推至上一位（例：`2.1.7.9` → `2.1.8.0`、`2.1.9.9` → `2.2.0.0`）。
   - **嚴禁擅自跳大版本**：除非使用者明確指示，否則不得跳號或自行提升 `X`、`Y`、`Z`。

---

## 3. 同步更新 3 個核心檔案

務必確認以下 3 個檔案的版本號、日期（`YYYY-MM-DD`）與實質變更內容完全同步：

1. **`src/js/changelog.js`**
   - 在 `CHANGELOG` 物件**最前面**（既有最新版本鍵之上）插入新版本條目，包含 `date`、`title`，以及對應的 `features`、`improvements`、`bugfixes` 陣列（無該類變更時可省略該陣列欄位，每筆字串以 `新功能:`／`優化:`／`修復:` 開頭）。
   - 同步更新檔案下方 `ChangelogManager` 建構子中 `__APP_VERSION__` 未定義時的預設版本備援字串。
2. **`CHANGE_LOG.md`**
   - 在文件最前面（`# 輕鬆記帳 2.0 - 更新日誌` 標題下方）插入新的 Markdown 版本區塊，格式對齊既有條目：
     ```markdown
     ## vX.Y.Z.W (YYYY-MM-DD) - <版本摘要標題>

     ### ✨ 新功能

     - **新功能: <項目標題>**：<說明內容>

     ### 🐛 錯誤修復

     - **修復: <項目標題>**：<說明內容>

     ---
     ```
3. **`package.json`**
   - 更新頂層 `"version"` 欄位為 `X.Y.Z.W`。

---

## 4. 條件性文件檢查

依本次版本的實質異動範圍，檢查是否須同步更新對應文件（無相關異動則保持不動）：

- 異動到 **`src/js/pluginManager.js`**（或外掛 API、權限與生命週期規格變更）→ 檢查並更新 **`PLUGIN_DEV_GUIDE.md`**。
- 異動到 **`src/js/themeManager.js`**（或主題色票變數、樣式規範變更）→ 檢查並更新 **`THEME_DEV_GUIDE.md`**。
- 包含**重大架構異動**（例如新增核心服務、同步通道、部署方式或主要使用者功能亮點）→ 檢查並更新 **`README.md`**（及必要時更新 `project-structure.md`）。

---

## 5. 發版前驗證

完成上述編輯後，執行以下指令確認版本結構、測試、語法檢查與打包注入皆正確無誤：

```bash
npx vitest run tests/unit/changelog.test.js && npm test && npm run lint && npm run build
```

確認項目：
- `tests/unit/changelog.test.js` 全數通過（驗證條目結構、日期格式 `YYYY-MM-DD` 及最新日期降序不小於前一版）。
- 全量單元測試 `npm test` 通過、`npm run lint` 無 error。
- `npm run build` 輸出訊息中顯示 Service Worker 已正確注入新版本號（`✅ Service Worker 已注入 vX.Y.Z.W`）。

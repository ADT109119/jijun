# 輕鬆記帳 (Easy Accounting) 主題開發指南

歡迎使用輕鬆記帳主題系統！本文件將引導您開發自訂外觀主題 (Theme)，透過定義 JSON 檔改變全域色彩與特定圖示，打造個性化體驗。

## 1. 主題結構

一個標準的主題是一個 `.json` 檔案。主題分為三個部分：`meta` (基本資訊)、`colors` (顏色覆寫)、`icons` (圖示替換)。

```json
{
  "id": "com.yourname.themename",
  "name": "我的自訂主題",
  "description": "這是一個展示用的主題",
  "version": "1.0",
  "author": "作者名稱",
  "colors": {
    "wabi-bg": "#121212",
    "wabi-primary": "#BB86FC",
    "wabi-expense": "#CF6679",
    "wabi-income": "#03DAC6",
    "wabi-accent": "#03DAC6",
    "wabi-text-primary": "#E1E1E1",
    "wabi-text-secondary": "#A0A0A0",
    "wabi-surface": "#1E1E1E",
    "wabi-border": "#2C2C2C"
  },
  "icons": {
    "nav#bottom-nav a[data-page='home'] i.fa-house": {
      "type": "fontawesome",
      "className": "fa-solid fa-moon"
    }
  }
}
```

## 2. Colors 參數對照表

您可以覆寫以下 9 種系統預設的 CSS 變數，它們影響了全站的 TailwindCSS 樣式：

* `wabi-bg`：最底層背景色 (預設：`#F5F5F3`)
* `wabi-primary`：主色調，通常用於頂部導覽、按鈕背景或標題字 (預設：`#334A52`)
* `wabi-expense`：支出顏色，用於支出金額或支出按鈕 (預設：`#B95A5A`)
* `wabi-income`：收入顏色，用於收入金額或收入按鈕 (預設：`#6A9C89`)
* `wabi-accent`：強調色，目前主要用於新增紀錄 `+` 按鈕背景 (預設：`#E2B67A`)
* `wabi-text-primary`：主要文字顏色，如標題或一般內文 (預設：`#2D3748`)
* `wabi-text-secondary`：次要文字顏色，如描述或未選取的標籤 (預設：`#718096`)
* `wabi-surface`：卡片背景色，如明細列表的卡片 (預設：`#FFFFFF`)
* `wabi-border`：邊框顏色，分隔線或卡片邊框 (預設：`#E2E8F0`)

## 3. Icons 替換方式

`icons` 物件的 `key` 是一段 **CSS Selector** (選擇器)，會用來尋找畫面上要替換的元素。系統會將符合選擇器的原始元素隱藏，並在旁邊插入您定義的新元素。

您可以透過 `type` 屬性指定三種替換模式：

### (1) 替換為 FontAwesome Icon
```json
"nav#bottom-nav a[data-page='home'] i.fa-house": {
  "type": "fontawesome",
  "className": "fa-solid fa-star"
}
```
* **type**: 必須為 `"fontawesome"`。
* **className**: 指定您想替換的 fontawesome class。

### (2) 替換為 SVG 字串
```json
".add-btn-icon": {
  "type": "svg",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M12 2L2 22h20L12 2z\"/></svg>",
  "className": "text-wabi-primary w-6 h-6"
}
```
* **type**: 必須為 `"svg"`。
* **svg**: 完整的 SVG 標籤字串 (如果包含引號，請在 JSON 中轉義 `\"`)。
* **className** (可選): 您想加在 `<svg>` 標籤上的 class。

### (3) 替換為 圖片 (PNG / JPG / Base64)
```json
"#sidebar-ledger-icon i": {
  "type": "image",
  "src": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "className": "rounded-full shadow-sm",
  "width": "24px",
  "height": "24px"
}
```
* **type**: 必須為 `"image"`。
* **src**: 圖片的路徑，可以是相對於網站的 URL，也強烈建議直接塞入 **Base64** 以確保離線可用性。
* **width** / **height** (可選): 強制設定圖片大小。
* **className** (可選): 追加在 `<img>` 標籤上的 class。

> **注意：**因為畫面元素可能隨著頁面切換或動態載入產生，主題系統會使用 `MutationObserver` 持續監聽 DOM 變化，並自動替換後續出現的元素，確保您設定的替換能夠完美套用到每一個角落。
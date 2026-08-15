// welcomeTour.js — 初次開啟歡迎 Modal 導覽配置
// #U08 導覽功能 (Onboarding & Feature Tour)
export const welcomeTour = {
    type: 'welcome',
    pages: [
        {
            icon: 'fa-solid fa-shield-halved',
            title: '純本機儲存・隱私完全自主',
            body: '輕鬆記帳採用 100% 本機 IndexedDB 離線存儲技術，所有帳目只留在你的裝置上，零上傳、無廣告追蹤，保障最高隱私安全。',
        },
        {
            icon: 'fa-solid fa-chart-pie',
            title: '靈活記帳・深度分析報表',
            body: '具備直覺數字鍵盤、預算即時進度監控、分類佔比圓餅圖、月度收支趨勢與日曆金流明細，全方位掌握財務動態。',
        },
        {
            icon: 'fa-solid fa-boxes-stacked',
            title: '多帳本・多元資產・分期與借貸',
            body: '支援多帳本獨立隔離、現金/銀行/信用卡/電子支付資產分流、大額消費分期攤提、借貸欠款追蹤與多人分帳群組。',
        },
        {
            icon: 'fa-solid fa-wand-magic-sparkles',
            title: '離線 AI 助手・隨時啟程',
            body: '支援本地端側 AI 語音記帳，說句話自動解析分類與金額！隨時可於「設定 → 導覽教學」重新觀看，讓我們開始吧！',
        },
    ],
}


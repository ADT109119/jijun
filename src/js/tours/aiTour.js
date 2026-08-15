// aiTour.js — AI 離線記帳語音助手導覽
// #U08 導覽功能 (Onboarding & Feature Tour)
export const aiTour = {
    id: 'ai',
    toggle: {
        title: 'AI 語音記帳已開啟',
        body: '現在「新增紀錄」圖標會變成麥克風，點擊即可用語音記錄收支，AI 自動解析金額、類別與備註。',
        goto: '#add',
        gotoLabel: '去試試語音記帳',
    },
    steps: [
        {
            target: '#nav-add-icon',
            goto: '#add',
            title: '本地離線 AI 記帳',
            body: '採用裝置端 58M 輕量大模型與語音識別技術，推論完全在手機本機離線運算，無需聯網，100% 保障財務隱私安全！',
            position: 'bottom',
        },
        {
            target: '#nav-add-icon',
            title: '用語音說出消費',
            body: '點擊麥克風圖標，自然說出如「今天中午跟同事吃牛肉麵 180 元」或「搭計程車 250」，AI 會即時進行語意解析。',
            position: 'bottom',
        },
        {
            target: '#add-amount-display',
            title: '智慧欄位自動填入',
            body: 'AI 會自動提取金額（180）、匹配最適分類（飲食）、填寫備註說明（跟同事吃牛肉麵）並推薦標籤，大幅節省手動點選時間！',
            position: 'top',
        },
    ],
}


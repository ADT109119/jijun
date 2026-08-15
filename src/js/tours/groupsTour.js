// groupsTour.js — 群組分帳導覽
// #U08 導覽功能 (Onboarding & Feature Tour)
export const groupsTour = {
    id: 'groups',
    toggle: {
        title: '群組功能已開啟',
        body: '現在你可以為聚餐、旅行、合租等多人場景建立群組，共享記帳並自動計算誰該付多少。',
        goto: '#groups',
        gotoLabel: '去管理群組',
    },
    steps: [
        {
            target: '#groups-list-container',
            title: '群組與專案總覽',
            body: '為旅遊、合租、聚餐活動或專案活動（如「2026 日本行」、「辦公室零用金」）建立獨立分帳空間。',
            position: 'top',
        },
        {
            target: '#add-group-btn',
            title: '建立新群組',
            body: '點擊「+」輸入群組名稱與備註，快速建立多人活動分帳專區。',
            position: 'top',
        },
        {
            target: '#groups-list-container',
            title: '自動計算分攤淨額',
            body: '群組卡片自動計算總支出、總收入與待結清淨額。支援「查看明細」檢視單筆項目、個別還款或「一鍵結清」整個活動！',
            position: 'top',
        },
        {
            target: '#toggle-group-btn',
            goto: '#add',
            title: '記帳頁歸入群組',
            body: '在記帳頁點擊頂部的「圖層群組」圖標，即可展開群組面板，將這筆日常消費直接歸入特定群組進行分攤。',
            position: 'bottom',
        },
        {
            target: '#group-panel',
            expand: '#toggle-group-btn',
            title: '選取或快速新建群組',
            body: '展開面板後可搜尋已有群組或快速建立新群組。儲存後該筆交易將自動計入群組總帳並更新分攤金額！',
            position: 'bottom',
        },
    ],
}


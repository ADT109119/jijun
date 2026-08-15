// debtsTour.js — 欠款管理導覽
// #U08 導覽功能 (Onboarding & Feature Tour)
export const debtsTour = {
    id: 'debts',
    toggle: {
        title: '欠款管理已開啟',
        body: '現在你可以記錄誰欠你錢或你欠誰錢，設定還款計畫，系統自動追蹤餘額與結清狀態。',
        goto: '#debts',
        gotoLabel: '去管理欠款',
    },
    steps: [
        {
            target: '#summary-cards-container',
            title: '欠款與借貸總覽',
            body: '頂部即時統整「應收（別人欠我）」與「應付（我欠別人）」的總額及淨額差，隨時掌握與他人的金流往來。',
            position: 'bottom',
        },
        {
            target: '#add-debt-btn',
            title: '獨立新增欠款',
            body: '點擊「+」按鈕可直接建立一筆單純的借貸紀錄，填入聯絡人、金額、借貸方向與約定還款日期。',
            position: 'top',
        },
        {
            target: '#show-summary-table-btn',
            title: '聯絡人欠款總表',
            body: '點擊可展開所有聯絡人的欠款彙總表，集中檢視每位對象的累計應收與應付總額。',
            position: 'top',
        },
        {
            target: '#debt-list-container',
            title: '欠款列表與結清',
            body: '下方列出所有借貸明細。每筆欠款均支援「部分還款」逐步沖銷餘額，或在全額清償後進行「一鍵結清」。',
            position: 'top',
        },
        {
            target: '#toggle-debt-btn',
            goto: '#add',
            title: '記帳頁快速標記欠款',
            body: '在新增收支時，點擊頂部的「握手」圖標即可展開欠款標記面板，將日常消費直接計入借貸，一步搞定！',
            position: 'bottom',
        },
        {
            target: '#debt-panel',
            expand: '#toggle-debt-btn',
            title: '設定借貸方向與聯絡人',
            body: '展開面板後：\n•「別人欠我」：如替朋友代墊餐費，同時記錄支出並建立應收欠款。\n•「我欠別人」：如朋友替你付錢，自動建立應付欠款。\n選取聯絡人後儲存，系統自動同步至欠款管理！',
            position: 'bottom',
        },
    ],
}


// accountsTour.js — 多帳戶（高級模式）導覽
// #U08 導覽功能 (Onboarding & Feature Tour)
export const accountsTour = {
    id: 'accounts',
    toggle: {
        title: '多帳戶模式已開啟',
        body: '現在你可以建立多個帳戶（現金、銀行、信用卡…）分類管理資金，並在帳戶間轉帳，系統自動保持帳目平衡。',
        goto: '#accounts',
        gotoLabel: '去管理帳戶',
    },
    steps: [
        {
            target: '#accounts-list',
            title: '資產帳戶總覽',
            body: '集中檢視所有帳戶（現金皮夾、銀行活存、信用卡、電子支付等）的即時餘額與淨資產總額。',
            position: 'top',
        },
        {
            target: '#add-account-btn',
            title: '建立新帳戶',
            body: '點擊「+」可新增不同類型的帳戶，設定初始餘額、自訂圖示與代表色，分類管理不同資金來源。',
            position: 'top',
        },
        {
            target: '#transfer-btn',
            title: '帳戶間資金轉帳',
            body: '在帳戶之間提款、轉帳或繳款時，點擊此處選擇轉出與轉入帳戶，系統自動生成關聯紀錄，保持總資產精確平衡。',
            position: 'top',
        },
        {
            target: '#account-selector-container',
            goto: '#add',
            title: '記帳時指定扣款帳戶',
            body: '在新增紀錄時，點擊帳戶按鈕即可指定這筆消費是由哪個帳戶出帳（或收入存入哪個帳戶），系統會實時更新該帳戶餘額！',
            position: 'bottom',
        },
    ],
}


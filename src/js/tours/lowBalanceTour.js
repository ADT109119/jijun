// lowBalanceTour.js — 餘額不足提醒導覽
// #U08 導覽功能 (Onboarding & Feature Tour)
// 實驗功能開關（lowBalanceWarningEnabled）開啟時，
// 透過 settingsPage 的 showToggleTour('lowBalance') 在設定頁彈介紹氣泡，
// 點擊「去記帳試試」跳轉記帳頁觸發操作導覽。
export const lowBalanceTour = {
    id: 'lowBalance',
    toggle: {
        title: '餘額不足提醒已開啟',
        body: '記帳時若該筆支出會讓帳戶透支、或信用卡欠款超出額度，儲存前會先跳出黃色警示（不阻擋記帳）。',
        goto: '#add',
        gotoLabel: '去記帳試試',
    },
    steps: [
        {
            target: '#add-amount-display',
            title: '記帳前自動檢查',
            body: '儲存支出時，系統會以「目前餘額 − 本筆金額」預算該帳戶記帳後的餘額。一般帳戶轉為負值、或信用卡欠款超出額度時，會先顯示警示訊息再儲存。',
            position: 'bottom',
        },
        {
            target: null,
            title: '只提醒、不阻擋',
            body: '警示僅是友善提醒，仍可照常儲存這筆紀錄。建議看到警示後確認金額或改用其他帳戶，避免意外透支。',
            position: 'bottom',
        },
    ],
}

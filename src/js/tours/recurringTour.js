// recurringTour.js — 週期交易導覽
// #U08 導覽功能 (Onboarding & Feature Tour)
export const recurringTour = {
    id: 'recurring',
    steps: [
        {
            target: '#recurring-list-container',
            title: '定期交易總覽',
            body: '專門處理每週、每月或每年的固定循環收支，例如每月 5 號發薪水、10 號付房租、各項訂閱串流服務等。',
            position: 'top',
        },
        {
            target: '#add-recurring-btn',
            title: '新增週期規則',
            body: '點擊「+」設定交易名稱、金額、收支分類、重複頻率與生效起訖日。',
            position: 'top',
        },
        {
            target: '#recurring-list-container',
            title: '無感自動記帳',
            body: '只要時間到達設定的扣款日，每次開啟 App 時系統會自動建立對應的記帳紀錄，告別手動重複輸入的煩惱！',
            position: 'top',
        },
    ],
}


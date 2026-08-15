// budgetTour.js — 預算導覽
// #U08 導覽功能 (Onboarding & Feature Tour)
export const budgetTour = {
    id: 'budget',
    steps: [
        {
            target: '#budget-amount',
            title: '設定每月預算上限',
            body: '在首頁點擊預算金額即可自訂本月支出上限，為個人或家庭設定合理的開銷目標。',
            position: 'bottom',
        },
        {
            target: '#budget-progress',
            title: '即時消耗進度與警示',
            body: '進度條會依據本月已發生的支出即時更新百分比與剩餘額度。當接近或超出預算時會以醒目顏色提醒，有效防止過度消費！',
            position: 'bottom',
        },
    ],
}


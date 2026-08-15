// basicGuideTour.js — 基本流程引導（初次進行完整記帳流程）
// #U08 導覽功能 (Onboarding & Feature Tour)
export const basicGuideTour = {
    id: 'basics',
    steps: [
        {
            target: '.nav-item[data-page="add"]',
            title: '記帳',
            body: '點擊這裡可以快速新增一筆收支紀錄。',
            position: 'bottom',
        },
        {
            target: '.nav-item[data-page="stats"]',
            title: '統計',
            body: '查看您的消費分類與月度趨勢。',
            position: 'bottom',
        },
        {
            target: '.nav-item[data-page="debts"]',
            title: '欠款管理',
            body: '記錄借出去或欠別人的金額，並記錄還款進度。',
            position: 'bottom',
        },
    ],
}

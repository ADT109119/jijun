// statisticsTour.js — 統計導覽
// #U08 導覽功能 (Onboarding & Feature Tour)
export const statisticsTour = {
    id: 'statistics',
    steps: [
        {
            target: '#stats-container',
            title: '收支統計圖表',
            body: '提供圓餅圖、長條圖與月度趨勢線，直觀呈現各大分類（飲食、交通、娛樂等）的開銷比重與變化。',
            position: 'bottom',
        },
        {
            target: '#stats-calendar-container',
            title: '行事曆金流檢視',
            body: '以月曆網格呈現每天的收支熱點與 Top 3 支出項目，點擊任意日期即可展開當日的完整消費明細。',
            position: 'top',
        },
    ],
}


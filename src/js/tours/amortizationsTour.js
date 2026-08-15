// amortizationsTour.js — 攤提/分期導覽
// #U08 導覽功能 (Onboarding & Feature Tour)
export const amortizationsTour = {
    id: 'amortizations',
    toggle: {
        title: '攤提/分期已開啟',
        body: '現在你可以為大額購入或長期項目設定分期計畫，自動計算每期金額與還款；也可在「新增紀錄」頁直接為這筆記錄建立分期。',
        goto: '#amortizations',
        gotoLabel: '去管理分期計畫',
    },
    steps: [
        {
            target: '#amort-list',
            title: '分期、折舊與攤提總覽',
            body: '專為大額支出設計！支援「信用卡分期付款」、「固定資產折舊（如筆電設備）」與「長期費用攤提（如年繳保費、租金）」，平攤每期財務負擔。',
            position: 'top',
        },
        {
            target: '#add-amort-btn',
            title: '手動建立分期計畫',
            body: '點擊「+」可設定總金額、期數（如 12 期）、扣款頻率（每月/每週/每年）、首付金額與年利率，系統自動計算每期應繳本息。',
            position: 'top',
        },
        {
            target: '#amort-list',
            title: '每期自動入帳',
            body: '在此檢視各計畫的進度與每期扣款金額。到達扣款日時，系統在啟動時自動為你生成當期記帳紀錄，無需手動追蹤！',
            position: 'top',
        },
        {
            target: '#toggle-installment-btn',
            goto: '#add',
            title: '記帳時直接分期',
            body: '在新增紀錄頁輸入大額消費時，點擊頂部的「信用卡」圖標，即可直接將該筆紀錄轉為分期或攤提計畫！',
            position: 'bottom',
        },
        {
            target: '#installment-panel',
            expand: '#toggle-installment-btn',
            title: '分期面板即時試算',
            body: '展開面板後選擇類型（分期/折舊/攤提），填入期數與利率，下方會即時試算每期金額。儲存時立即建立計畫，邊記帳邊完成長期規劃！',
            position: 'bottom',
        },
    ],
}


// newFeaturesTourV2.js — v2.1.8.0 新版功能總覽導覽（版本專屬）
// #U08 導覽功能 (Onboarding & Feature Tour)
// 由 TOUR_VERSION_MAP 於版本更新彈窗（changelog）選擇「查看教學」後觸發，
// 帶使用者巡覽本次版本的主要新功能。
// 注意：步驟目標元素若不存在（如多帳戶模式未開啟時的圓點/按鈕），
// 該步驟會自動跳過，不會卡住導覽。
export const newFeaturesTourV2 = {
    id: 'newFeaturesV2',
    steps: [
        {
            target: '#stats-calendar-container',
            goto: '#stats',
            title: '行事曆繳款圓點',
            body: '收支分析的月曆日格會直接標示信用卡繳款日（紅點）與出帳日（藍點），懸停可看卡名與日期，繳款週期一眼掌握。多帳戶模式開啟即自動顯示，也可在設定頁「行事曆繳款圓點」單獨關閉。',
            position: 'bottom',
        },
        {
            target: null,
            title: '聯絡人欠款匯出',
            body: '聯絡人管理頁每筆聯絡人新增「匯出欠款」按鈕，依發生月份條列該聯絡人的全部欠款（含已結清），可一鍵複製或分享純文字明細，與朋友對帳不再手動抄錄。',
            position: 'bottom',
        },
        {
            target: '#sync-server-url-input',
            goto: '#sync-settings',
            beforeShow() {
                // 同步頁為「Google 雲端／自架伺服器」模式 selector，
                // 此步驟講解自架部署說明連結，需先程式化切到自架分頁，
                // 否則氣泡會指到 Google 雲端服務地址輸入框、與文案不符。
                // （beforeShow 於每次 showStep 重試前執行，
                //  goto 導航後重試時 page 已存在即可生效）
                try {
                    const page = window.app?.router?.routes?.['sync-settings']
                    if (page) {
                        const prevMode = page.activeMode
                        page.activeMode = 'selfhost'
                        if (
                            window.location.hash === '#sync-settings' &&
                            (prevMode !== 'selfhost' ||
                                !document.querySelector('#sync-server-url-input'))
                        ) {
                            page.render?.()?.catch?.(() => {})
                        }
                    }
                } catch (e) {
                    /* 導覽 best-effort，不阻斷 */
                }
            },
            title: '自架同步說明直達',
            body: '雲端同步的「官方雲端」已更名「Google 雲端」。自架伺服器使用者：區塊右上角新增「部署與使用說明」連結，直達完整部署指南（含環境變數、帳號管理、家人共用帳本）。',
            position: 'bottom',
        },
    ],
}

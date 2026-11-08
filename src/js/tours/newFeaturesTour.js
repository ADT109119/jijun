// newFeaturesTour.js — 新版功能總覽導覽（版本專屬）
// #U08 導覽功能 (Onboarding & Feature Tour)
// 由 TOUR_VERSION_MAP 於版本更新彈窗（changelog）選擇「查看教學」後觸發，
// 帶使用者巡覽本次版本的主要新功能。
// 注意：步驟目標元素若不存在（如多帳戶模式未開啟時的 #account-selector-btn），
// 該步驟會自動跳過，不會卡住導覽。
export const newFeaturesTour = {
    id: 'newFeatures',
    steps: [
        {
            target: '#sync-server-url-input',
            goto: '#sync-settings',
            beforeShow() {
                // 同步頁已重設計為「官方雲端／自架伺服器」模式 selector，
                // 此步驟講解自架同步，需先程式化切到自架分頁，
                // 否則氣泡會指到官方服務地址輸入框、與文案不符。
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
            title: '純自架同步伺服器',
            body: '雲端同步現在可以不綁 Google 帳號！切換「自架伺服器」模式、填入自己的同步伺服器地址（SQLite 儲存）即可登入使用，資料掌握在自己手裡。部署與帳號管理說明請點自架區塊右上角的「部署與使用說明」連結。',
            position: 'bottom',
        },
        {
            target: '#low-balance-warning-toggle',
            goto: '#settings',
            title: '餘額不足提醒',
            body: '記帳前預先檢查：若該筆支出會讓帳戶透支、或信用卡欠款超出額度，儲存時會先跳出黃色警示（不阻擋記帳）。在設定頁「餘額不足提醒」開關即可啟用。',
            position: 'top',
        },
        {
            target: '#records-fields-btn',
            goto: '#records',
            title: '明細欄位顯示/隱藏',
            body: '明細頁右上角新增「欄位」按鈕，可依帳本自訂要顯示哪些欄位（備註、欠款狀態、帳戶、日期），讓明細清單只保留你關心的資訊。',
            position: 'bottom',
        },
        {
            target: '#account-selector-btn',
            goto: '#add',
            title: '帳戶釘選置頂',
            body: '多帳戶模式下，選擇帳戶的清單中點擊圖釘圖示，就能把常用的帳戶釘選置頂（依帳本各自設定），記帳時快速切換不再翻找。',
            position: 'top',
        },
        {
            target: null,
            title: '其他改進',
            body: '・月預算可選未來月份預覽\n・統計報告日期範圍新增「本季度 / 上季度」\n・週期交易清單可拖曳排序\n・離線存活優化：本機化外部函式庫，冷啟動更快\n・資料儲存安全強化：更新後資料不再可能看似消失',
            position: 'bottom',
        },
    ],
}

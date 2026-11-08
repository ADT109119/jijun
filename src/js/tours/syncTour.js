// syncTour.js — 雲端備份與同步導覽
// #U08 導覽功能 (Onboarding & Feature Tour)
export const syncTour = {
    id: 'sync',
    steps: [
        {
            target: '#sync-mode-official',
            title: '雙軌同步服務模式',
            body: '「輕鬆記帳」支援雙軌雲端同步！可依個人偏好切換「Google 雲端」或「自架伺服器」：Google 模式使用個人雲端硬碟備份；自架伺服器模式則連接專屬 Docker 伺服器，資料完全自主掌控。',
            position: 'bottom',
        },
        {
            target: '#sync-mode-selfhost',
            title: '自架伺服器模式',
            body: '點擊切換為自架伺服器模式，可填入自建伺服器網址、以專屬帳號與 PIN 碼安全登入，支援跨裝置同步與家庭共用帳本！',
            position: 'bottom',
        },
        {
            target: '#sync-sign-in-btn, #sync-selfhost-login-btn, #sync-sign-out-btn, #sync-selfhost-signout-btn',
            title: '帳號登入與連線',
            body: '點擊以登入您的帳號。完成授權後，即可啟用完整的雲端備份、自動備份排程與多裝置即時同步功能。',
            position: 'bottom',
        },
        {
            target: '#sync-backup-btn',
            title: '手動雲端備份與還原',
            body: '登入後可隨時點擊「立即備份」打包全帳本明細、分類與預算；換機或資料轉移時，點擊「還原備份」即可挑選歷史版本一鍵完整恢復。',
            position: 'top',
        },
        {
            target: '#sync-auto-backup-toggle',
            title: '自動備份與多裝置同步',
            body: '開啟「自動備份」與「自動同步」，記帳時系統便會在背景為您即時跨裝置推播資料，防範資料遺失無後顧之憂！',
            position: 'top',
        },
    ],
}

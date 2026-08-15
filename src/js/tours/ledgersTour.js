// ledgersTour.js — 帳本管理導覽
// #U08 導覽功能 (Onboarding & Feature Tour)
export const ledgersTour = {
    id: 'ledgers',
    steps: [
        {
            target: '#add-ledger-btn',
            title: '建立獨立帳本',
            body: '為不同生活場景建立獨立帳本（如「個人日常」、「家庭開銷」、「公司報帳」、「出國旅遊」），收支與帳戶完全隔離。',
            position: 'top',
        },
        {
            target: '#join-ledger-btn',
            title: '加入共用帳本',
            body: '透過雲端邀請連結加入家人或夥伴共享的帳本，進行多人協同記帳。',
            position: 'top',
        },
    ],
}


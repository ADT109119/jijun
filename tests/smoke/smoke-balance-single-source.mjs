// #BAL-DRY 帳戶餘額單一真相源收斂 — Playwright 真實 Chromium 冒煙測試
// 驗證含一般收支、payable 欠款原始紀錄、receivable 代墊紀錄與還款平帳時，
// DataService、帳戶頁 (#accounts) 與統計頁 (#stats) 三處顯示餘額 100% 一致。
// 用法: npm run build && npx vite preview --port 4173 &  然後  node tests/smoke/smoke-balance-single-source.mjs
import { chromium } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const APP_VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version

function resolveLaunchOpts() {
    const candidates = [
        join(homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux/chrome'),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
    ]
    for (const p of candidates) {
        if (existsSync(p)) return { executablePath: p }
    }
    return {}
}

const BASE = process.env.SMOKE_BASE || 'http://localhost:4173'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
    if (ok) pass++
    else fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

const browser = await chromium.launch(resolveLaunchOpts())
const context = await browser.newContext({ serviceWorkers: 'block' })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', e => pageErrors.push(String(e)))
await page.addInitScript(ver => {
    localStorage.setItem('guide_completed_version', JSON.stringify(ver))
    localStorage.setItem('app-current-version', ver)
    localStorage.setItem('app-last-seen-version', ver)
}, APP_VERSION)

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
    () => window.app && window.app.dataService && window.app.dataService.db,
    null,
    { timeout: 30000 }
)

// 1. 植入測試資料：開啟進階多帳戶與欠款管理，建立帳戶並寫入混合收支與 payable/receivable 欠款
const seeded = await page.evaluate(async () => {
    const ds = window.app.dataService
    await ds.saveSetting({ key: 'advancedAccountModeEnabled', value: true })
    await ds.saveSetting({ key: 'debtManagementEnabled', value: true })

    const today = new Date().toISOString().slice(0, 10)
    const accId = await ds.addAccount({
        name: '一致測試活存',
        type: 'bank',
        balance: 10000,
        icon: 'fa-solid fa-building-columns',
        color: 'bg-blue-500',
    })
    const contactId = await ds.addContact({ name: '測試好友' })

    // +5000 收入
    await ds.addRecord({
        type: 'income',
        amount: 5000,
        category: 'salary',
        description: '薪資',
        date: today,
        accountId: accId,
    })
    // -2000 支出
    await ds.addRecord({
        type: 'expense',
        amount: 2000,
        category: 'food',
        description: '聚餐',
        date: today,
        accountId: accId,
    })
    // payable 欠款 3000（別人先幫付，我尚未實際付款 → 不應扣減帳戶餘額）
    const payableDebtId = await ds.addDebt({
        contactId,
        type: 'payable',
        amount: 3000,
        originalAmount: 3000,
        remainingAmount: 3000,
        date: today,
        description: '好友代墊機票',
    })
    const payableRecId = await ds.addRecord({
        type: 'expense',
        amount: 3000,
        category: 'transport',
        description: '好友代墊機票',
        date: today,
        accountId: accId,
        debtId: payableDebtId,
    })
    await ds.updateDebt(payableDebtId, { recordId: payableRecId })

    // receivable 欠款 1000（我先墊付現金 → 必須扣減帳戶餘額）
    const receivableDebtId = await ds.addDebt({
        contactId,
        type: 'receivable',
        amount: 1000,
        originalAmount: 1000,
        remainingAmount: 1000,
        date: today,
        description: '幫買咖啡',
    })
    const receivableRecId = await ds.addRecord({
        type: 'expense',
        amount: 1000,
        category: 'food',
        description: '幫買咖啡',
        date: today,
        accountId: accId,
        debtId: receivableDebtId,
    })
    await ds.updateDebt(receivableDebtId, { recordId: receivableRecId })

    // 預期餘額：10000 + 5000 - 2000 - 1000 = 12000（排除 3000 payable 原始紀錄）
    const dsBalance = await ds.calculateAccountCurrentBalance(accId)
    return { accId, payableDebtId, today, dsBalance }
})
check(
    '階段 1 DataService.calculateAccountCurrentBalance 精確為 12000（排除 payable 原始紀錄）',
    seeded.dsBalance === 12000,
    `got=${seeded.dsBalance}`
)

// 2. 前往帳戶頁 (#accounts) 讀取卡片顯示餘額
await page.evaluate(() => {
    window.location.hash = '#accounts'
})
await page.waitForFunction(
    () => document.body.textContent?.includes('一致測試活存'),
    null,
    { timeout: 10000 }
)
await page.waitForTimeout(400)
const accountsPageText = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('div, li, section')]
    const card = cards.find(
        el =>
            el.textContent?.includes('一致測試活存') &&
            el.textContent?.includes('$12,000') &&
            el.textContent.length < 300
    )
    return { matched: !!card, snippet: card?.textContent?.replace(/\s+/g, ' ').trim() || '' }
})
check(
    '階段 1 帳戶頁 (#accounts) 顯示餘額為 $12,000',
    accountsPageText.matched,
    accountsPageText.snippet
)

// 3. 前往統計頁 (#stats) 選取該帳戶並驗證 #stats-account-balance 顯示相同餘額
await page.evaluate(() => {
    window.location.hash = '#stats'
})
await page.waitForSelector('#stats-account-filter', { timeout: 10000 })
await page.selectOption('#stats-account-filter', String(seeded.accId))
await page.waitForFunction(
    () => !document.getElementById('stats-account-balance-card')?.classList.contains('hidden'),
    null,
    { timeout: 10000 }
)
const statsBalance1 = await page.textContent('#stats-account-balance')
check(
    '階段 1 統計頁 (#stats) 顯示餘額與帳戶頁／DataService 完全一致 ($12,000)',
    statsBalance1?.trim() === '$12,000',
    `stats=${statsBalance1?.trim()}`
)

// 4. 實際還款 3000（debt_repayment）後，三處餘額同步變為 $9,000
const afterRepay = await page.evaluate(async ({ accId, payableDebtId, today }) => {
    const ds = window.app.dataService
    await ds.addRecord({
        type: 'expense',
        amount: 3000,
        category: 'debt_repayment',
        description: '還好友機票錢',
        date: today,
        accountId: accId,
        debtId: payableDebtId,
    })
    await ds.updateDebt(payableDebtId, { remainingAmount: 0, settled: true })
    return await ds.calculateAccountCurrentBalance(accId)
}, seeded)
check(
    '階段 2 還款後 DataService 餘額更新為 9000',
    afterRepay === 9000,
    `got=${afterRepay}`
)

await page.evaluate(() => {
    window.location.hash = '#accounts'
})
await page.waitForFunction(
    () => document.body.textContent?.includes('一致測試活存') && document.body.textContent?.includes('$9,000'),
    null,
    { timeout: 10000 }
)
check('階段 2 帳戶頁 (#accounts) 同步更新為 $9,000', true)

await page.evaluate(() => {
    window.location.hash = '#stats'
})
await page.waitForSelector('#stats-account-filter', { timeout: 10000 })
await page.selectOption('#stats-account-filter', String(seeded.accId))
await page.waitForFunction(
    () => document.getElementById('stats-account-balance')?.textContent?.trim() === '$9,000',
    null,
    { timeout: 10000 }
)
const statsBalance2 = await page.textContent('#stats-account-balance')
check(
    '階段 2 統計頁 (#stats) 同步更新為 $9,000（三處單一真相源一致）',
    statsBalance2?.trim() === '$9,000',
    `stats=${statsBalance2?.trim()}`
)

const ownErrors = pageErrors.filter(
    e => !/pagead|doubleclick|googletag|adsbygoogle|capacitor|AdMob/i.test(e)
)
check('無自有程式 JS 錯誤', ownErrors.length === 0, ownErrors.slice(0, 3).join(' | '))

await browser.close()
console.log(`\n== BAL-DRY 冒煙結果: ${pass} PASS / ${fail} FAIL ==`)
process.exit(fail > 0 ? 1 : 0)

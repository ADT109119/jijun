// #SEC06 showInputModal 與各編輯彈窗 value 屬性 XSS 跳脫 — Playwright 真實 Chromium 冒煙測試
// 驗證含雙引號與標籤注入之 defaultValue/資料於 showInputModal、SettingsPage、PreferencesPage、
// DebtManager、AccountsPage 編輯彈窗皆無 attribute breakout、無 XSS 執行，且編輯值完整無損回傳。
// 用法: npm run build && npx vite preview --port 4173 &  然後  node tests/smoke/smoke-sec06-inputmodal.mjs
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
const PAYLOAD_IMG = '"><img src=x onerror="window.__sec06Pwn=1">'
const PAYLOAD_ATTR = '" autofocus onfocus="window.__sec06Focus=1" data-evil="'
const PAYLOAD_SCRIPT = '<script>window.__sec06Script=1</script>'

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
    () => window.app && window.app.dataService && window.app.dataService.db && window.app.router,
    null,
    { timeout: 30000 }
)

async function assertNoXss() {
    return await page.evaluate(() => ({
        pwn: window.__sec06Pwn,
        focus: window.__sec06Focus,
        script: window.__sec06Script,
        imgs: document.querySelectorAll('img[src="x"]').length,
    }))
}

// 1. SettingsPage.showInputModal — defaultValue/title/message XSS payload + round-trip
const settingsModalRes = await page.evaluate(
    async ({ imgPayload, scriptPayload }) => {
        const sp = window.app.router.routes.settings
        let confirmed = null
        sp.showInputModal(scriptPayload, imgPayload, imgPayload, val => {
            confirmed = val
        })
        await new Promise(r => setTimeout(r, 150))
        const input = document.getElementById('settings-input-value')
        const valueBeforeClick = input ? input.value : null
        const imgs = document.querySelectorAll('img[src="x"]').length
        const scripts = [...document.querySelectorAll('script')].filter(s =>
            s.textContent.includes('__sec06Script')
        ).length
        document.getElementById('settings-input-ok')?.click()
        await new Promise(r => setTimeout(r, 100))
        return { valueBeforeClick, confirmed, imgs, scripts }
    },
    { imgPayload: PAYLOAD_IMG, scriptPayload: PAYLOAD_SCRIPT }
)
check(
    'SettingsPage.showInputModal 阻擋屬性突破且無損回傳原始字串',
    settingsModalRes.valueBeforeClick === PAYLOAD_IMG &&
        settingsModalRes.confirmed === PAYLOAD_IMG &&
        settingsModalRes.imgs === 0 &&
        settingsModalRes.scripts === 0,
    JSON.stringify({ imgs: settingsModalRes.imgs, matched: settingsModalRes.confirmed === PAYLOAD_IMG })
)

// 2. PreferencesPage.showInputModal — attribute breakout payload
const prefModalRes = await page.evaluate(
    async ({ attrPayload, imgPayload }) => {
        const pp = window.app.router.routes.preferences
        let confirmed = null
        pp.showInputModal('偏好測試', imgPayload, attrPayload, val => {
            confirmed = val
        })
        await new Promise(r => setTimeout(r, 150))
        const input = document.getElementById('pref-input-value')
        const hasFocusAttr = input?.hasAttribute('onfocus')
        const val = input?.value
        document.getElementById('pref-input-ok')?.click()
        await new Promise(r => setTimeout(r, 100))
        return { hasFocusAttr, val, confirmed }
    },
    { attrPayload: PAYLOAD_ATTR, imgPayload: PAYLOAD_IMG }
)
check(
    'PreferencesPage.showInputModal 阻擋 autofocus/onfocus 注入並保留原始值',
    prefModalRes.hasFocusAttr === false &&
        prefModalRes.val === PAYLOAD_ATTR &&
        prefModalRes.confirmed === PAYLOAD_ATTR,
    JSON.stringify({ hasFocusAttr: prefModalRes.hasFocusAttr, matched: prefModalRes.confirmed === PAYLOAD_ATTR })
)

// 3. DebtManager 編輯欠款彈窗 — 歷史髒 description/date
const debtModalRes = await page.evaluate(
    async ({ imgPayload, attrPayload }) => {
        const ds = window.app.dataService
        const contactId = await ds.addContact({ name: '安全測試對象' })
        await window.app.debtManager.showAddDebtModal({
            id: 999,
            type: 'receivable',
            contactId,
            originalAmount: 500,
            date: attrPayload,
            description: imgPayload,
        })
        await new Promise(r => setTimeout(r, 150))
        const desc = document.getElementById('debt-description')
        const dateEl = document.getElementById('debt-date')
        const res = {
            descVal: desc?.value,
            hasOnFocus: dateEl?.hasAttribute('onfocus'),
            imgs: document.querySelectorAll('img[src="x"]').length,
        }
        document.getElementById('cancel-debt-btn')?.click()
        return res
    },
    { imgPayload: PAYLOAD_IMG, attrPayload: PAYLOAD_ATTR }
)
check(
    'DebtManager 編輯欠款彈窗阻擋 description/date 屬性突破',
    debtModalRes.descVal === PAYLOAD_IMG &&
        debtModalRes.hasOnFocus === false &&
        debtModalRes.imgs === 0,
    JSON.stringify({ imgs: debtModalRes.imgs, matched: debtModalRes.descVal === PAYLOAD_IMG })
)

// 4. AccountsPage 帳戶編輯彈窗 — 歷史髒名稱與髒數值欄位
const accModalRes = await page.evaluate(
    async ({ imgPayload, attrPayload }) => {
        const ap = window.app.router.routes.accounts
        await ap.showAccountModal({
            id: 1,
            name: imgPayload,
            type: 'credit_card',
            balance: attrPayload,
            creditLimit: imgPayload,
            statementDay: 15,
            paymentDueDay: 5,
            icon: imgPayload,
            color: '#3b82f6',
        })
        await new Promise(r => setTimeout(r, 150))
        const nameInput = document.getElementById('account-name-input')
        const balInput = document.getElementById('account-balance-input')
        const res = {
            nameVal: nameInput?.value,
            balHasFocus: balInput?.hasAttribute('onfocus'),
            imgs: document.querySelectorAll('img[src="x"]').length,
        }
        document.getElementById('cancel-account-btn')?.click()
        return res
    },
    { imgPayload: PAYLOAD_IMG, attrPayload: PAYLOAD_ATTR }
)
check(
    'AccountsPage 帳戶編輯彈窗阻擋名稱與餘額欄位屬性突破',
    accModalRes.nameVal === PAYLOAD_IMG &&
        accModalRes.balHasFocus === false &&
        accModalRes.imgs === 0,
    JSON.stringify({ imgs: accModalRes.imgs, matched: accModalRes.nameVal === PAYLOAD_IMG })
)

const xssState = await assertNoXss()
check(
    '全程無任何 XSS 全域旗標被觸發、無 <img src=x> 節點殘留',
    xssState.pwn === undefined &&
        xssState.focus === undefined &&
        xssState.script === undefined &&
        xssState.imgs === 0,
    JSON.stringify(xssState)
)

const ownErrors = pageErrors.filter(
    e => !/pagead|doubleclick|googletag|adsbygoogle|capacitor|AdMob/i.test(e)
)
check('無自有程式 JS 錯誤', ownErrors.length === 0, ownErrors.slice(0, 3).join(' | '))

await browser.close()
console.log(`\n== SEC06 冒煙結果: ${pass} PASS / ${fail} FAIL ==`)
process.exit(fail > 0 ? 1 : 0)

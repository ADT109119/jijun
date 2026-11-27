// #QSM-ATTR 快速記帳膠囊 data-* 屬性跳脫與比對刪除 — Playwright 真實 Chromium 冒煙測試
// 驗證含雙引號、單引號、尖括號與 XSS payload 的快速記帳膠囊在真實 #add 頁面：
// 1. 不觸發 attribute breakout 或 XSS 執行
// 2. 點擊膠囊後 #add-note-input 無損還原原始含引號文字
// 3. 右鍵刪除膠囊能精準比對並自 localStorage 移除
// 用法: npm run build && npx vite preview --port 4173 &  然後  node tests/smoke/smoke-quickselect-capsule.mjs
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
const PAYLOAD_XSS = '買"大杯"咖啡"><img src=x onerror="window.__qsmPwn=1">'
const PAYLOAD_QUOTES = `A"B'C<D>E&F`

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
    () => window.app && window.app.dataService && window.app.dataService.db && window.app.quickSelectManager,
    null,
    { timeout: 30000 }
)

// 1. 植入含 XSS 與特殊字元的快速記帳記錄（含被污染的 accountId 字串）
await page.evaluate(
    ({ xssDesc, quotesDesc }) => {
        const qsm = window.app.quickSelectManager
        qsm.records = [
            {
                type: 'expense',
                categoryId: 'food',
                description: xssDesc,
                accountId: '1"><img src=x onerror="window.__qsmAccPwn=1">',
                count: 5,
                lastUsed: Date.now(),
            },
            {
                type: 'expense',
                categoryId: 'food',
                description: quotesDesc,
                accountId: null,
                count: 3,
                lastUsed: Date.now() - 1000,
            },
            {
                type: 'expense',
                categoryId: 'food',
                description: '正常午餐',
                accountId: null,
                count: 1,
                lastUsed: Date.now() - 2000,
            },
        ]
        qsm.saveRecords()
    },
    { xssDesc: PAYLOAD_XSS, quotesDesc: PAYLOAD_QUOTES }
)

// 2. 前往 #add 頁面並等待快速記帳膠囊渲染
await page.evaluate(() => {
    window.location.hash = '#add'
})
await page.waitForSelector('.quick-select-capsule', { timeout: 15000 })

// 3. 驗證無 XSS 執行、無注入節點、且 data-description 完整保留原始字串
const domAudit = await page.evaluate(
    ({ xssDesc, quotesDesc }) => {
        const capsules = [...document.querySelectorAll('.quick-select-capsule')]
        return {
            count: capsules.length,
            pwn: window.__qsmPwn,
            accPwn: window.__qsmAccPwn,
            imgs: document.querySelectorAll('img[src="x"]').length,
            hasOnErrorAttr: capsules.some(c => c.hasAttribute('onerror')),
            xssDatasetMatch: capsules.some(c => c.dataset.description === xssDesc),
            quotesDatasetMatch: capsules.some(c => c.dataset.description === quotesDesc),
            poisonedAccSanitized: capsules[0]?.dataset.accountId === 'null',
        }
    },
    { xssDesc: PAYLOAD_XSS, quotesDesc: PAYLOAD_QUOTES }
)
check(
    '膠囊渲染無 XSS 執行、無 attribute breakout，且 dataset 無損保留特殊字元',
    domAudit.count === 3 &&
        domAudit.pwn === undefined &&
        domAudit.accPwn === undefined &&
        domAudit.imgs === 0 &&
        domAudit.hasOnErrorAttr === false &&
        domAudit.xssDatasetMatch === true &&
        domAudit.quotesDatasetMatch === true &&
        domAudit.poisonedAccSanitized === true,
    JSON.stringify(domAudit)
)

// 4. 點擊含 XSS/雙引號的膠囊，確認 #add-note-input 無損填入原始字串
await page.evaluate(xssDesc => {
    const btn = [...document.querySelectorAll('.quick-select-capsule')].find(
        c => c.dataset.description === xssDesc
    )
    btn?.click()
}, PAYLOAD_XSS)
await page.waitForTimeout(200)
const filledNote = await page.inputValue('#add-note-input')
check(
    '點擊含雙引號/尖括號膠囊後，#add-note-input 無損還原原始文字',
    filledNote === PAYLOAD_XSS,
    `matched=${filledNote === PAYLOAD_XSS}`
)

// 5. 對含特殊字元（A"B'C<D>E&F）的膠囊觸發右鍵選單刪除，驗證精準比對並自 localStorage 移除
const deleteRes = await page.evaluate(async quotesDesc => {
    const btn = [...document.querySelectorAll('.quick-select-capsule')].find(
        c => c.dataset.description === quotesDesc
    )
    if (!btn) return { found: false }
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 100))
    const delBtn = document.getElementById('delete-quick-select-btn')
    if (!delBtn) return { found: true, menuOpened: false }
    delBtn.click()
    await new Promise(r => setTimeout(r, 150))
    const stored = JSON.parse(localStorage.getItem('quickSelectRecords') || '[]')
    return {
        found: true,
        menuOpened: true,
        remainingCount: stored.length,
        stillHasTarget: stored.some(r => r.description === quotesDesc),
        stillHasNormal: stored.some(r => r.description === '正常午餐'),
    }
}, PAYLOAD_QUOTES)
check(
    '右鍵刪除含引號/尖括號/& 膠囊可精準比對並移除，其餘膠囊保留',
    deleteRes.found &&
        deleteRes.menuOpened &&
        deleteRes.remainingCount === 2 &&
        deleteRes.stillHasTarget === false &&
        deleteRes.stillHasNormal === true,
    JSON.stringify(deleteRes)
)

const ownErrors = pageErrors.filter(
    e => !/pagead|doubleclick|googletag|adsbygoogle|capacitor|AdMob/i.test(e)
)
check('無自有程式 JS 錯誤', ownErrors.length === 0, ownErrors.slice(0, 3).join(' | '))

await browser.close()
console.log(`\n== QSM-ATTR 冒煙結果: ${pass} PASS / ${fail} FAIL ==`)
process.exit(fail > 0 ? 1 : 0)

// #AB1-HIST 退休模擬「歷史重演」報酬模型 — Playwright 真實 Chromium 冒煙測試
// 驗證常態抽樣與歷史重演切換、區塊長度 1–10 調整、統計摘要與圖表渲染、決定性重現與錯誤防呆。
// 用法: npm run build && npx vite preview --port 4173 &  然後  node tests/smoke/smoke-retirement-historical.mjs
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

await page.goto(`${BASE}/#retirement`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
    () => window.app && window.app.dataService && window.app.dataService.db,
    null,
    { timeout: 30000 }
)
await page.evaluate(() => {
    window.location.hash = '#retirement'
})
await page.waitForSelector('#ret-model-toggle', { timeout: 15000 })

// 1. 初始預設為常態抽樣（i.i.d.）
const initialState = await page.evaluate(() => ({
    normalPressed: document.getElementById('ret-model-normal')?.getAttribute('aria-pressed'),
    histPressed: document.getElementById('ret-model-historical')?.getAttribute('aria-pressed'),
    normalHidden: document.getElementById('ret-normal-fields')?.classList.contains('hidden'),
    histHidden: document.getElementById('ret-historical-fields')?.classList.contains('hidden'),
    defaultBlockSize: document.getElementById('ret-block-size')?.value,
    resultsHidden: document.getElementById('retirement-results')?.classList.contains('hidden'),
}))
check(
    '初始狀態：預設常態抽樣、歷史區塊欄位隱藏、預設區塊長度為 5',
    initialState.normalPressed === 'true' &&
        initialState.histPressed === 'false' &&
        initialState.normalHidden === false &&
        initialState.histHidden === true &&
        initialState.defaultBlockSize === '5' &&
        initialState.resultsHidden === true,
    JSON.stringify(initialState)
)

// 2. 執行常態抽樣模擬
await page.click('#ret-run')
await page.waitForFunction(
    () => !document.getElementById('retirement-results')?.classList.contains('hidden'),
    null,
    { timeout: 10000 }
)
const normalResult = await page.evaluate(() => ({
    badge: document.getElementById('ret-model-badge')?.textContent?.trim() || '',
    cards: document.getElementById('ret-summary-cards')?.textContent?.trim() || '',
    hasCanvas: !!document.getElementById('ret-chart'),
}))
check(
    '常態抽樣模擬成功渲染結果與模型徽章',
    normalResult.badge.includes('常態抽樣') &&
        normalResult.cards.includes('%') &&
        normalResult.hasCanvas,
    normalResult.badge
)

// 3. 切換為歷史重演（區塊抽樣，預設為台股加權報酬指數 IR0001 / 1x 台指期理論基準）
await page.click('#ret-model-historical')
const histToggle = await page.evaluate(() => ({
    normalPressed: document.getElementById('ret-model-normal')?.getAttribute('aria-pressed'),
    histPressed: document.getElementById('ret-model-historical')?.getAttribute('aria-pressed'),
    normalHidden: document.getElementById('ret-normal-fields')?.classList.contains('hidden'),
    histHidden: document.getElementById('ret-historical-fields')?.classList.contains('hidden'),
    datasetVal: document.getElementById('ret-historical-dataset')?.value,
    infoText: document.getElementById('ret-historical-info')?.textContent?.trim() || '',
}))
check(
    '切換歷史重演：預設台股加權報酬指數 IR0001 (2003–2025，23 年，含台指期基準說明)',
    histToggle.normalPressed === 'false' &&
        histToggle.histPressed === 'true' &&
        histToggle.normalHidden === true &&
        histToggle.histHidden === false &&
        histToggle.datasetVal === 'taiex_tr' &&
        histToggle.infoText.includes('IR0001') &&
        histToggle.infoText.includes('台指期') &&
        histToggle.infoText.includes('2003') &&
        histToggle.infoText.includes('2025') &&
        histToggle.infoText.includes('23 年'),
    histToggle.infoText.replace(/\s+/g, ' ').slice(0, 110)
)

// 4. 執行歷史重演模擬（預設 taiex_tr, blockSize=5）並驗證決定性重現
await page.click('#ret-run')
await page.waitForFunction(
    () => document.getElementById('ret-model-badge')?.textContent?.includes('台股加權報酬指數'),
    null,
    { timeout: 10000 }
)
const histRun1 = await page.evaluate(() => ({
    badge: document.getElementById('ret-model-badge')?.textContent?.trim() || '',
    cards: document.getElementById('ret-summary-cards')?.textContent?.trim() || '',
}))
await page.click('#ret-run')
await page.waitForTimeout(300)
const histRun2 = await page.evaluate(() => ({
    badge: document.getElementById('ret-model-badge')?.textContent?.trim() || '',
    cards: document.getElementById('ret-summary-cards')?.textContent?.trim() || '',
}))
check(
    '歷史重演（台股加權報酬指數 · 5 年區塊）模擬成功且同種子重現完全一致',
    histRun1.badge.includes('歷史重演') &&
        histRun1.badge.includes('台股加權報酬指數') &&
        histRun1.badge.includes('5 年') &&
        histRun1.badge.includes('2003–2025') &&
        histRun1.cards === histRun2.cards,
    histRun1.badge
)

// 4b. 切換為元大台灣50 (0050) 與美股 S&P 500 並驗證摘要與模擬結果徽章更新
await page.selectOption('#ret-historical-dataset', 'tw0050_tr')
const info0050 = await page.textContent('#ret-historical-info')
await page.click('#ret-run')
await page.waitForFunction(
    () => document.getElementById('ret-model-badge')?.textContent?.includes('0050'),
    null,
    { timeout: 10000 }
)
const badge0050 = await page.textContent('#ret-model-badge')
check(
    '切換至元大台灣50 (0050 含息) 正確更新摘要 (2004–2025) 並完成模擬',
    Boolean(info0050?.includes('0050') && info0050?.includes('2004') && badge0050?.includes('0050') && badge0050?.includes('2004–2025')),
    badge0050?.trim()
)

await page.selectOption('#ret-historical-dataset', 'sp500_tr')
const infoSp500 = await page.textContent('#ret-historical-info')
await page.click('#ret-run')
await page.waitForFunction(
    () => document.getElementById('ret-model-badge')?.textContent?.includes('S&P 500'),
    null,
    { timeout: 10000 }
)
const badgeSp500 = await page.textContent('#ret-model-badge')
check(
    '切換至美股 S&P 500 正確更新摘要 (1928–2025，98 年) 並完成模擬',
    Boolean(infoSp500?.includes('S&P 500') && infoSp500?.includes('1928') && infoSp500?.includes('98 年') && badgeSp500?.includes('S&P 500') && badgeSp500?.includes('1928–2025')),
    badgeSp500?.trim()
)

// 切回預設 taiex_tr 後繼續邊界測試
await page.selectOption('#ret-historical-dataset', 'taiex_tr')

// 5. 調整區塊長度邊界值：1 年與 10 年
for (const bs of [1, 10]) {
    await page.fill('#ret-block-size', String(bs))
    await page.click('#ret-run')
    await page.waitForFunction(
        expected =>
            document.getElementById('ret-model-badge')?.textContent?.includes(expected),
        `連續 ${bs} 年區塊`,
        { timeout: 10000 }
    )
    const badge = await page.textContent('#ret-model-badge')
    check(
        `區塊長度邊界值 ${bs} 年可正常完成模擬`,
        Boolean(badge && badge.includes(`連續 ${bs} 年區塊`)),
        badge?.trim()
    )
}

// 6. 非法區塊長度（11）優雅拒絕且按鈕恢復可用
await page.fill('#ret-block-size', '11')
await page.click('#ret-run')
await page.waitForTimeout(400)
const invalidCheck = await page.evaluate(() => ({
    btnDisabled: document.getElementById('ret-run')?.disabled,
    bodyText: document.body.textContent || '',
}))
check(
    '非法區塊長度（11）顯示錯誤提示且按鈕恢復可點擊',
    invalidCheck.btnDisabled === false && invalidCheck.bodyText.includes('1-10'),
    JSON.stringify({ btnDisabled: invalidCheck.btnDisabled })
)

// 7. 切回常態抽樣確認雙向切換無殘留
await page.click('#ret-model-normal')
await page.click('#ret-run')
await page.waitForFunction(
    () => document.getElementById('ret-model-badge')?.textContent?.includes('常態抽樣'),
    null,
    { timeout: 10000 }
)
const backToNormal = await page.textContent('#ret-model-badge')
check(
    '可切回常態抽樣並重新模擬',
    Boolean(backToNormal && backToNormal.includes('常態抽樣')),
    backToNormal?.trim()
)

const ownErrors = pageErrors.filter(
    e => !/pagead|doubleclick|googletag|adsbygoogle|capacitor|AdMob/i.test(e)
)
check('無自有程式 JS 錯誤', ownErrors.length === 0, ownErrors.slice(0, 3).join(' | '))

await browser.close()
console.log(`\n== AB1-HIST 冒煙結果: ${pass} PASS / ${fail} FAIL ==`)
process.exit(fail > 0 ? 1 : 0)

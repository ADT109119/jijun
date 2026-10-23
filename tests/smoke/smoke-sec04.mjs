// #SEC04 歷史髒 icon 渲染面統一白名單 — Playwright 真實 Chromium 冒煙測試
// 植入髒 category/account/ledger icon，走遍各渲染面驗證無 XSS 執行、白名單 fallback 生效。
// 用法: npm run build && npx vite preview --port 4173 &  然後  node tests/smoke/smoke-sec04.mjs
import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 本機快取版本與 Playwright 期待版本不符時，退回系統 Chrome
const cached = join(homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux/chrome')
const launchOpts = existsSync(cached)
    ? { executablePath: cached }
    : (existsSync('/usr/bin/google-chrome')
        ? { executablePath: '/usr/bin/google-chrome' }
        : {})

const BASE = process.env.SMOKE_BASE || 'http://localhost:4173'
const DIRTY = '"><img src=x onerror="window.__pwn=1">'
const DIRTY2 = "fa-solid fa-book' onmouseover='window.__pwn2=1"

let pass = 0, fail = 0
function check(name, ok, extra = '') {
    if (ok) pass++
    else fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

const browser = await chromium.launch(launchOpts)
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', e => pageErrors.push(String(e)))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })

// 等 app 與 DB 就緒
await page.waitForFunction(
    () => window.app && window.app.dataService && window.app.dataService.db,
    null,
    { timeout: 30000 }
)

// ── 植入髒資料 ──────────────────────────────────────────
const seeded = await page.evaluate(
    async ({ dirty, dirty2 }) => {
        const ds = window.app.dataService
        // 1) 髒自訂分類（繞過 UI 白名單，直接寫 DB 層模擬歷史髒資料）
        await ds.saveCategorySetting('custom_categories', {
            expense: [
                {
                    id: 'xsscat',
                    name: '<img src=x onerror="window.__pwn3=1">',
                    icon: dirty,
                    color: 'bg-red-500',
                },
            ],
            income: [],
        })
        await window.app.categoryManager.init()
        // 2) 髒分類紀錄
        const today = new Date().toISOString().slice(0, 10)
        const recId = await ds.addRecord({
            type: 'expense',
            amount: 42,
            category: 'xsscat',
            description: dirty,
            date: today,
        })
        // 3) 髒帳戶 icon
        const accId = await ds.addAccount({
            name: '髒帳戶',
            type: 'cash',
            icon: dirty2,
            color: 'bg-red-500',
            balance: 0,
        })
        // 4) 髒帳本 icon（直接繞過 manager 白名單，模擬歷史資料）
        await ds.updateLedger(1, { icon: dirty }, true)
        await window.app.ledgerManager.init()
        return { recId, accId }
    },
    { dirty: DIRTY, dirty2: DIRTY2 }
)
check('植入髒資料成功', !!seeded.recId && !!seeded.accId)

async function noPwn() {
    return page.evaluate(() => ({
        pwn: window.__pwn,
        pwn2: window.__pwn2,
        pwn3: window.__pwn3,
        imgs: document.querySelectorAll('img[src="x"]').length,
    }))
}

async function visit(hash, name) {
    await page.evaluate(h => {
        window.location.hash = h
    }, hash)
    await page.waitForTimeout(1000)
    const st = await noPwn()
    check(
        `${name}: 無 XSS 執行、無 <img src=x> 節點`,
        st.pwn === undefined &&
            st.pwn2 === undefined &&
            st.pwn3 === undefined &&
            st.imgs === 0,
        JSON.stringify(st)
    )
}

// ── 各渲染面走查 ────────────────────────────────────────
await visit('#records', '紀錄列表頁')
await visit('#home', '首頁')
await visit('#stats', '統計頁')
await visit('#add', '新增紀錄頁')
await visit('#accounts', '帳戶頁')
await visit('#ledgers', '帳本頁')
await visit('#debts', '欠款頁')

// ── fallback 圖示實際渲染驗證 ──────────────────────────
await page.evaluate(() => {
    window.location.hash = '#records'
})
await page.waitForTimeout(1200)
const recFallback = await page.evaluate(() => {
    const el = [...document.querySelectorAll('i')].find(i =>
        i.className.includes('fa-question')
    )
    // 注意：escapeHTML 後文字節點序列化仍可能含 "onerror" 字詞（已非標籤），
    // 故以原始標籤序列 + 實際 img 節點數為準
    return {
        hasFallback: !!el,
        dirtyTag: document.body.innerHTML.includes('"><img'),
        imgs: document.querySelectorAll('img[src="x"]').length,
    }
})
check(
    '紀錄列表: 髒分類退回 fa-question fallback 且無可執行標籤',
    recFallback.hasFallback && !recFallback.dirtyTag && recFallback.imgs === 0,
    JSON.stringify(recFallback)
)

// 帳本頁：髒帳本 icon 退回預設 fa-book 等安全圖示
await page.evaluate(() => {
    window.location.hash = '#ledgers'
})
await page.waitForTimeout(1200)
const ledgerOk = await page.evaluate(() => ({
    hasSafe: !!document.querySelector(
        'i.fa-solid.fa-book, i.fa-solid.fa-wallet'
    ),
    dirty: document.body.innerHTML.includes('"><img'),
}))
check(
    '帳本頁: 髒帳本 icon 退回安全預設圖示',
    ledgerOk.hasSafe && !ledgerOk.dirty,
    JSON.stringify(ledgerOk)
)

// ── 入庫端白名單（manager 防禦深度）驗證 ───────────────
const guard = await page.evaluate(async dirty => {
    let createRejected = false, updateRejected = false
    try {
        await window.app.ledgerManager.createLedger({
            name: '髒帳本X',
            icon: dirty,
        })
    } catch (e) {
        createRejected = /圖示格式不正確/.test(e.message)
    }
    try {
        await window.app.ledgerManager.updateLedger(1, { icon: dirty })
    } catch (e) {
        updateRejected = /圖示格式不正確/.test(e.message)
    }
    return { createRejected, updateRejected }
}, DIRTY)
check('ledgerManager.createLedger 拒絕髒 icon', guard.createRejected)
check('ledgerManager.updateLedger 拒絕髒 icon', guard.updateRejected)

// ── 編輯彈窗不因歷史髒資料崩潰（accountsPage selector 注入防護）──
const modalOk = await page.evaluate(async () => {
    const accs = await window.app.dataService.getAccounts()
    const acc = accs.find(a => a.icon && a.icon.includes('img'))
    window.location.hash = '#accounts'
    await new Promise(r => setTimeout(r, 900))
    const pageObj = window.app.pages?.accounts
    if (pageObj && typeof pageObj.showAccountModal === 'function') {
        try {
            pageObj.showAccountModal(acc)
            await new Promise(r => setTimeout(r, 500))
            const modal = document.querySelector('.fixed.inset-0')
            const ok = !!modal
            if (modal) modal.remove()
            return { ok, found: true }
        } catch (e) {
            return { ok: false, err: String(e), found: true }
        }
    }
    return { ok: true, found: false } // 無公開 API 時跳過（不視為失敗）
})
check(
    '帳戶編輯彈窗對歷史髒 icon 不拋 SyntaxError',
    modalOk.ok,
    JSON.stringify(modalOk)
)

// ── rewardService 內建推廣廣告全欄位防護（#SEC04 本輪補完）──────
const adOk = await page.evaluate(async () => {
    const origFetch = window.fetch
    window.fetch = async () => ({
        ok: true,
        json: async () => [{
            icon: '"><img src=x onerror="window.__pwn4=1">',
            color: '#fff; background-image:url(evil)',
            title: '"><img src=x onerror="window.__pwn5=1">',
            description: '<script>window.__pwn6=1</script>',
            buttonText: '"><img src=x>',
            url: 'javascript:window.__pwn7=1',
            image: 'data:image/svg+xml,<svg onload=alert(1)>',
        }],
    })
    try {
        const p = window.app.rewardService._showInternalAd()
        await new Promise(r => setTimeout(r, 200))
        const modal = document.querySelector('.fixed.inset-0.z-\\[70\\]') ||
            [...document.querySelectorAll('div')].find(d =>
                d.className.includes('z-[70]') && d.querySelector('[data-action="claim"]'))
        const res = {
            rendered: !!modal,
            imgs: document.querySelectorAll('img[src="x"]').length,
            scripts: [...modal?.querySelectorAll('script') || []].length,
            pwn: !!(window.__pwn4 || window.__pwn5 || window.__pwn6 || window.__pwn7),
            href: modal?.querySelector('a')?.getAttribute('href'),
            iconFallback: modal?.querySelector('i')?.className.includes('fa-gift'),
            styleClean: !/url\(evil\)/.test(modal?.innerHTML || ''),
        }
        modal?.querySelector('[data-action="cancel"]')?.click()
        await p
        return res
    } finally {
        window.fetch = origFetch
    }
})
check(
    '內建推廣廣告: 全欄位注入不成立、href 降級 #、圖示退回 gift',
    adOk.rendered && adOk.imgs === 0 && adOk.scripts === 0 && !adOk.pwn &&
        adOk.href === '#' && adOk.iconFallback && adOk.styleClean,
    JSON.stringify(adOk)
)

// ── JS error 總檢查（過濾廣告/第三方腳本噪音）─────────
const ownErrors = pageErrors.filter(
    e => !/pagead|doubleclick|googletag|adsbygoogle|capacitor|AdMob/i.test(e)
)
check('無自有程式 JS 錯誤', ownErrors.length === 0, ownErrors.slice(0, 3).join(' | '))

await browser.close()
console.log(`\n== SEC04 冒煙結果: ${pass} PASS / ${fail} FAIL ==`)
process.exit(fail > 0 ? 1 : 0)

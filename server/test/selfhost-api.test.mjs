// Self-host server 端到端測試（直接呼叫 router，不佔用 port）
// 需要 Node.js >= 22.5（node:sqlite）
import { handleRequest } from '../src/index.js'
import { SqliteStore } from '../src/db.js'

const store = new SqliteStore(':memory:')
await store.init()
const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', ALLOWED_ORIGINS: '*' }
// SELF_HOST_ALLOW_REGISTER: 模擬「已開放註冊」的 server（註冊開關測試另用獨立 store）
const ctx = { store, env: { ...env, BACKUP_RETENTION_COUNT: 5, SELF_HOST_ALLOW_REGISTER: true } }

let passed = 0
let failed = 0
function check(name, cond, extra) {
    if (cond) {
        passed++
        console.log(`  PASS  ${name}`)
    } else {
        failed++
        console.log(`  FAIL  ${name}`, extra ?? '')
    }
}

async function req(method, path, { body, token, headers = {} } = {}, testCtx = ctx) {
    const url = `http://localhost:8080${path}`
    const h = { ...headers }
    if (body !== undefined) h['Content-Type'] = 'application/json'
    if (token) h['Authorization'] = `Bearer ${token}`
    const r = await handleRequest(
        new Request(url, {
            method,
            headers: h,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
        env,
        testCtx
    )
    let json = null
    const ct = r.headers.get('Content-Type') || ''
    const text = await r.text()
    if (ct.includes('json')) {
        try { json = JSON.parse(text) } catch (_) {}
    }
    // headers 轉 plain object（小寫 key）供安全標頭斷言
    const resHeaders = {}
    r.headers.forEach((v, k) => { resHeaders[k] = v })
    return { status: r.status, json, text, headers: resHeaders }
}

console.log('== OAuth proxy 不受影響 ==')
let r = await req('GET', '/api/health')
check('health ok + selfHosted=true', r.status === 200 && r.json.selfHosted === true, r.json)

console.log('== register ==')
r = await req('POST', '/api/selfhost/register', {
    body: { username: 'alice', pin: 'secret-pin', deviceId: 'dev_phone_001' },
})
check('register 201 + token', r.status === 201 && typeof r.json.token === 'string', r.json)
const aliceToken = r.json.token

r = await req('POST', '/api/selfhost/register', {
    body: { username: 'alice', pin: 'wrong-pin' },
})
check('重複帳號 + 錯 PIN → 401', r.status === 401, r.status)

r = await req('POST', '/api/selfhost/register', {
    body: { username: 'alice', pin: 'secret-pin' },
})
check('重複帳號 + 對 PIN → 200 (login 語意)', r.status === 200 && r.json.alreadyRegistered === true, r.json)

r = await req('POST', '/api/selfhost/register', { body: { username: 'x', pin: '1234' } })
check('非法 username → 400', r.status === 400, r.json)

r = await req('POST', '/api/selfhost/register', { body: { username: 'alice', pin: '12' } })
check('PIN 太短 → 400', r.status === 400, r.json)

console.log('== login ==')
r = await req('POST', '/api/selfhost/login', { body: { username: 'alice', pin: 'secret-pin' } })
check('login 200 + token', r.status === 200 && r.json.token, r.json)
const aliceToken2 = r.json.token

r = await req('POST', '/api/selfhost/login', { body: { username: 'alice', pin: 'nope-nope' } })
check('login 錯 PIN → 401', r.status === 401, r.status)

console.log('== me / devices ==')
r = await req('GET', '/api/selfhost/me', { token: aliceToken2 })
check('me 回 username + 裝置', r.status === 200 && r.json.username === 'alice' && r.json.devices.some(d => d.deviceId === 'dev_phone_001'), r.json)

r = await req('GET', '/api/selfhost/me', { token: 'jijun_bad' })
check('壞 token → 401', r.status === 401, r.status)

r = await req('POST', '/api/selfhost/devices/register', {
    body: { deviceId: 'dev_laptop_002' },
    token: aliceToken2,
})
check('註冊第二裝置', r.status === 200 && r.json.deviceId === 'dev_laptop_002', r.json)

console.log('== push / pull ==')
const change1 = {
    operation: 'add',
    storeName: 'records',
    recordId: 1,
    data: { uuid: 'rec-uuid-1', amount: 100, ledgerUuid: 'led-1' },
    timestamp: 1000,
}
const change2 = {
    operation: 'update',
    storeName: 'records',
    recordId: 1,
    data: { uuid: 'rec-uuid-1', amount: 200, ledgerUuid: 'led-1' },
    timestamp: 2000,
}
r = await req('POST', '/api/selfhost/push', {
    body: { deviceId: 'dev_phone_001', changes: [change1, change2] },
    token: aliceToken2,
})
check('push 2 筆 → added=2 total=2', r.status === 200 && r.json.added === 2 && r.json.total === 2, r.json)

r = await req('POST', '/api/selfhost/push', {
    body: { deviceId: 'dev_phone_001', changes: [change1] },
    token: aliceToken2,
})
check('重複 push → added=0 total=2 (去重)', r.json.added === 0 && r.json.total === 2, r.json)

r = await req('POST', '/api/selfhost/push', {
    body: { deviceId: 'dev_phone_001', changes: [] },
    token: aliceToken2,
})
check('空 changes → 400', r.status === 400, r.status)

r = await req('POST', '/api/selfhost/push', {
    body: { deviceId: 'dev_other_user', changes: [change1] },
    token: aliceToken2,
})
check('push 未註冊裝置 → 自動註冊同帳號裝置（容忍順序）', r.status === 200, r.json)
// 修正：dev_other_user 應屬於 alice（自動註冊）
r = await req('GET', '/api/selfhost/me', { token: aliceToken2 })
check('自動註冊的裝置在 me 列表中', r.json.devices.some(d => d.deviceId === 'dev_other_user'), r.json.devices)

r = await req('GET', '/api/selfhost/pull?since=0&deviceId=dev_phone_001', { token: aliceToken2 })
check(
    'pull 排除自己裝置，回 laptop + other 之外… (phone 排除)',
    r.status === 200 && Array.isArray(r.json.devices),
    r.json
)
// phone 有 2 筆；排除 phone 後應剩 laptop(0) + other(1)
const pullNames = r.json.devices.map(d => d.deviceId)
check('pull 排除 dev_phone_001', !pullNames.includes('dev_phone_001'), pullNames)

r = await req('GET', '/api/selfhost/pull?since=1500&deviceId=dev_phone_001', { token: aliceToken2 })
// other 裝置只有 ts=1000 的變更 → since=1500 後全被過濾 → 不該回傳
check('pull since=1500 → 無變更裝置不迴傳 (過濾正確)', r.json.devices.length === 0, r.json.devices)

r = await req('GET', '/api/selfhost/pull?since=1500', { token: aliceToken2 })
const phoneEntry = r.json.devices.find(d => d.deviceId === 'dev_phone_001')
check('pull 含自己裝置時 phone 只剩 1 筆 (ts=2000)', phoneEntry && phoneEntry.changes.length === 1 && phoneEntry.changes[0].timestamp === 2000, phoneEntry)

console.log('== backup ==')
const backupContent = JSON.stringify({ records: [{ id: 1, amount: 100 }], accounts: [] })
r = await req('POST', '/api/selfhost/backup', {
    body: { fileName: 'backup_2026-08-26.json', content: backupContent, deviceId: 'dev_phone_001' },
    token: aliceToken2,
})
check('backup 201 + id', r.status === 201 && r.json.id, r.json)
const backupId = r.json.id

r = await req('POST', '/api/selfhost/backup', {
    body: { fileName: 'bad/../name.json', content: backupContent },
    token: aliceToken2,
})
check('非法 fileName → 400', r.status === 400, r.json)

r = await req('POST', '/api/selfhost/backup', {
    body: { fileName: 'ok.json', content: 'not-json' },
    token: aliceToken2,
})
check('非 JSON content → 400', r.status === 400, r.json)

r = await req('GET', '/api/selfhost/backups', { token: aliceToken2 })
check('backups list 1 筆 + Drive 相容欄位 (name/size/createdTime)', r.json.backups.length === 1 && r.json.backups[0].name === 'backup_2026-08-26.json' && r.json.backups[0].createdTime, r.json.backups)

r = await req('GET', `/api/selfhost/backups/${backupId}`, { token: aliceToken2 })
check('backup get 回傳原始 content', r.status === 200 && JSON.parse(r.text).records.length === 1, r.text.slice(0, 80))

r = await req('GET', '/api/selfhost/backups/99999', { token: aliceToken2 })
check('不存在的 backup → 404', r.status === 404, r.status)

console.log('== 跨帳號隔離 ==')
const bobReg = await req('POST', '/api/selfhost/register', { body: { username: 'bob', pin: 'bob-pin-1' } })
const bobToken = bobReg.json.token
r = await req('GET', '/api/selfhost/pull', { token: bobToken })
check('bob pull 看不到 alice 的裝置', r.json.devices.length === 0, r.json)
r = await req('GET', `/api/selfhost/backups/${backupId}`, { token: bobToken })
check('bob 取不到 alice 的 backup → 404', r.status === 404, r.status)
r = await req('POST', '/api/selfhost/push', {
    body: { deviceId: 'dev_phone_001', changes: [change2] },
    token: bobToken,
})
check('bob push 到 alice 的裝置 → 403', r.status === 403, r.json)

console.log('== retention ==')
// 再存 6 筆備份（retention=5）
for (let i = 0; i < 6; i++) {
    await req('POST', '/api/selfhost/backup', {
        body: { fileName: `backup_${i}.json`, content: JSON.stringify({ i }) },
        token: aliceToken2,
    })
}
r = await req('GET', '/api/selfhost/backups', { token: aliceToken2 })
check('retention=5 → 只留 5 筆', r.json.backups.length === 5, r.json.backups.length)

console.log('== delete backup ==')
// 注意：最早那筆（backupId）已被 retention 刪掉；改用列表裡還存在的一筆
r = await req('GET', '/api/selfhost/backups', { token: aliceToken2 })
const delId = r.json.backups[r.json.backups.length - 1].id
r = await req('DELETE', `/api/selfhost/backups/${delId}`, { token: aliceToken2 })
check('delete backup ok', r.status === 200 && r.json.deleted === true, r.json)
r = await req('GET', `/api/selfhost/backups/${delId}`, { token: aliceToken2 })
check('刪除後 get → 404', r.status === 404, r.status)

// ──────────────────────────────────────────────
// 註冊開關（獨立 store：預設關閉）
// ──────────────────────────────────────────────
console.log('== 註冊開關 ==')
const store2 = new SqliteStore(':memory:')
await store2.init()
await store2.setMeta('allow_register', '0')
const ctx2 = { store: store2, env: { ...env, BACKUP_RETENTION_COUNT: 5, SELF_HOST_ALLOW_REGISTER: false } }
r = await req('POST', '/api/selfhost/register', { body: { username: 'eve', pin: 'eve-pin-1' } }, ctx2)
check('註冊關閉 → 403', r.status === 403, r.json)
r = await req('GET', '/api/health', {}, ctx2)
check('health registerEnabled=false', r.json.registerEnabled === false, r.json)
store2.close()

// ──────────────────────────────────────────────
// Admin（帳號管理）
// ──────────────────────────────────────────────
console.log('== admin ==')
// 建立 admin 帳號（模擬 bootstrap）+ 發 token
const { createHash } = await import('node:crypto')
const adminUser = await ctx.store.createUserAsAdmin('admin', createHash('sha256').update('admin-pin-1').digest('hex'), true)
const { token: adminToken } = await ctx.store.createToken(adminUser.id)

r = await req('GET', '/api/selfhost/admin/users', { token: aliceToken2 })
check('非 admin 存取 admin API → 403', r.status === 403, r.status)

r = await req('POST', '/api/selfhost/admin/users', { body: { username: 'carol', pin: 'carol-pin-1' }, token: adminToken })
check('admin 建帳號 201', r.status === 201 && r.json.username === 'carol', r.json)

r = await req('POST', '/api/selfhost/admin/users', { body: { username: 'carol', pin: 'carol-pin-x' }, token: adminToken })
check('重複 username → 409', r.status === 409, r.status)

r = await req('GET', '/api/selfhost/admin/users', { token: adminToken })
check('admin 列表含 carol/admin', r.json.users.some(u => u.username === 'carol') && r.json.users.some(u => u.username === 'admin' && u.isAdmin), r.json.users?.length)

// carol 用新 PIN 登入成功
r = await req('POST', '/api/selfhost/login', { body: { username: 'carol', pin: 'carol-pin-1' } })
check('carol 新帳號可登入', r.status === 200 && typeof r.json.token === 'string', r.json)
const carolToken = r.json.token

r = await req('POST', '/api/selfhost/admin/users/carol/reset-pin', { body: { pin: 'new-pin-99' }, token: adminToken })
check('admin 重置 PIN', r.status === 200, r.json)
r = await req('POST', '/api/selfhost/login', { body: { username: 'carol', pin: 'new-pin-99' } })
check('重置後新 PIN 可登入', r.status === 200, r.status)
r = await req('POST', '/api/selfhost/login', { body: { username: 'carol', pin: 'carol-pin-1' } })
check('舊 PIN 失效 → 401', r.status === 401, r.status)

r = await req('DELETE', '/api/selfhost/admin/users/carol', { token: adminToken })
check('admin 刪帳號', r.status === 200 && r.json.deleted === true, r.json)
r = await req('POST', '/api/selfhost/login', { body: { username: 'carol', pin: 'new-pin-99' } })
check('已刪帳號無法登入 → 401', r.status === 401, r.status)
// regression: deleteUser 必須連帶清 sync_changes（無 FK cascade 的表需手動清）
const tempUser = await store.createUserAsAdmin('tempdel', createHash('sha256').update('pin-1').digest('hex'), false)
await store.registerDevice('dev-tempdel', tempUser.id, 'tempdel')
await store.appendDeviceLogChange('dev-tempdel', {
    deviceId: 'dev-tempdel', operation: 'add', storeName: 'records',
    recordId: '1', data: null, timestamp: Date.now(),
})
const scBefore = store.db.prepare('SELECT COUNT(*) AS c FROM sync_changes WHERE user_id = ?').get(tempUser.id).c
check('deleteUser 前 sync_changes 有殘留', scBefore >= 1, scBefore)
await store.deleteUser(tempUser.id)
const scAfter = store.db.prepare('SELECT COUNT(*) AS c FROM sync_changes WHERE user_id = ?').get(tempUser.id).c
const devAfter = store.db.prepare('SELECT COUNT(*) AS c FROM devices WHERE user_id = ?').get(tempUser.id).c
check('deleteUser 後 sync_changes 清空', scAfter === 0, scAfter)
check('deleteUser 後 devices 清空 (FK cascade)', devAfter === 0, devAfter)

r = await req('DELETE', '/api/selfhost/admin/users/admin', { token: adminToken })
check('不能刪 bootstrap admin → 400', r.status === 400, r.json)

// runtime 註冊開關
r = await req('PUT', '/api/selfhost/admin/settings/register', { body: { enabled: true }, token: adminToken })
check('admin 開註冊 200', r.status === 200 && r.json.registerEnabled === true, r.json)
check('ctx env 已同步', ctx.env.SELF_HOST_ALLOW_REGISTER === true)
r = await req('POST', '/api/selfhost/register', { body: { username: 'dave', pin: 'dave-pin-1' } })
check('runtime 開放後可註冊', r.status === 201, r.status)
r = await req('PUT', '/api/selfhost/admin/settings/register', { body: { enabled: false }, token: adminToken })
check('admin 關註冊 200', r.json.registerEnabled === false, r.json)
r = await req('POST', '/api/selfhost/register', { body: { username: 'frank', pin: 'frank-pin-1' } })
check('關閉後再註冊 → 403', r.status === 403, r.status)

// ──────────────────────────────────────────────
// Shared Ledgers（跨帳號共用帳本）
// ──────────────────────────────────────────────
console.log('== shared ledgers ==')
const SHARED_UUID = '11111111-2222-3333-4444-555555555555'
const sharedChange = {
    deviceId: 'dev_phone_001',
    operation: 'add',
    storeName: 'accounts',
    timestamp: 1700000001000,
    data: { uuid: 'acct-shared-1', name: '家庭公共帳戶' },
}

r = await req('POST', '/api/selfhost/shared', {
    body: {
        ledgerUuid: SHARED_UUID,
        name: '家庭支出',
        content: { deviceId: 'dev_phone_001', timestamp: 1700000001000, changes: [sharedChange] },
    },
    token: aliceToken2,
})
check('alice 建立共用帳本 201', r.status === 201 && r.json.uuid === SHARED_UUID, r.json)

r = await req('POST', '/api/selfhost/shared', {
    body: { ledgerUuid: SHARED_UUID },
    token: aliceToken2,
})
check('重複建立 → 409', r.status === 409, r.status)

r = await req('GET', '/api/selfhost/shared', { token: aliceToken2 })
check('alice 的 shared 列表 = 1', r.json.ledgers.length === 1 && r.json.ledgers[0].owner === true, r.json)

r = await req('GET', `/api/selfhost/shared/${SHARED_UUID}`, { token: aliceToken2 })
check('alice 讀 content（成員）', r.status === 200 && r.json.content.changes.length === 1, r.json.content?.changes?.length)

r = await req('GET', `/api/selfhost/shared/${SHARED_UUID}`, { token: bobToken })
check('bob 非成員 → 403', r.status === 403, r.status)

// alice 邀請 bob 加入
r = await req('POST', `/api/selfhost/shared/${SHARED_UUID}/members`, { body: { username: 'bob' }, token: aliceToken2 })
check('owner 加成員 bob', r.status === 200 && r.json.added === true, r.json)
r = await req('POST', `/api/selfhost/shared/${SHARED_UUID}/members`, { body: { username: 'bob' }, token: bobToken })
check('非 owner 加成員 → 403', r.status === 403, r.status)
r = await req('POST', `/api/selfhost/shared/${SHARED_UUID}/members`, { body: { username: 'nobody' }, token: aliceToken2 })
check('加不存在的 user → 404', r.status === 404, r.json)

r = await req('GET', `/api/selfhost/shared/${SHARED_UUID}`, { token: bobToken })
check('bob 加入後可讀', r.status === 200 && r.json.content.changes.length === 1, r.status)
r = await req('GET', `/api/selfhost/shared/${SHARED_UUID}/members`, { token: bobToken })
check('成員列表 2 人 + isOwner 對 bob=false', r.json.members.length === 2 && r.json.isOwner === false, r.json)
r = await req('GET', `/api/selfhost/shared/${SHARED_UUID}/members`, { token: aliceToken2 })
check('isOwner 對 alice=true', r.json.isOwner === true, r.json)

// bob 寫入（完整比對式覆寫）
const mergedContent = {
    deviceId: 'dev_bob_001',
    timestamp: 1700000002000,
    changes: [
        sharedChange,
        { deviceId: 'dev_bob_001', operation: 'update', storeName: 'accounts', timestamp: 1700000002000, data: { uuid: 'acct-shared-1', name: '家庭公共帳戶(更新)' } },
    ],
}
r = await req('PUT', `/api/selfhost/shared/${SHARED_UUID}`, { body: { content: mergedContent }, token: bobToken })
check('bob PUT content（成員）', r.status === 200 && typeof r.json.modifiedAt === 'number', r.json)
r = await req('PUT', `/api/selfhost/shared/${SHARED_UUID}`, { body: { content: { changes: null } }, token: bobToken })
check('content.changes 非陣列 → 400', r.status === 400, r.status)

r = await req('GET', `/api/selfhost/shared/${SHARED_UUID}`, { token: aliceToken2 })
check('alice 讀到合併後 2 筆 changes', r.json.content.changes.length === 2, r.json.content?.changes?.length)

// lookup（code = 完整 uuid 或前 8 字）
r = await req('GET', `/api/selfhost/shared/lookup?code=${SHARED_UUID}`, { token: bobToken })
check('lookup 完整 uuid', r.json.found === true && r.json.uuid === SHARED_UUID, r.json)
r = await req('GET', '/api/selfhost/shared/lookup?code=11111111', { token: bobToken })
check('lookup 前 8 字', r.json.found === true, r.json)
r = await req('GET', '/api/selfhost/shared/lookup?code=deadbeef', { token: bobToken })
check('lookup 不存在 → found=false', r.json.found === false, r.json)

// 移除成員
r = await req('DELETE', `/api/selfhost/shared/${SHARED_UUID}/members/bob`, { token: aliceToken2 })
check('owner 移除 bob', r.status === 200 && r.json.removed === true, r.json)
r = await req('GET', `/api/selfhost/shared/${SHARED_UUID}`, { token: bobToken })
check('移除後 bob → 403', r.status === 403, r.status)

// 刪除共用帳本（owner）
r = await req('DELETE', `/api/selfhost/shared/${SHARED_UUID}`, { token: bobToken })
check('非 owner 刪 → 403', r.status === 403, r.status)
r = await req('DELETE', `/api/selfhost/shared/${SHARED_UUID}`, { token: aliceToken2 })
check('owner 刪 200', r.status === 200 && r.json.deleted === true, r.json)
r = await req('GET', `/api/selfhost/shared/${SHARED_UUID}`, { token: aliceToken2 })
check('刪除後 → 404', r.status === 404, r.status)

// ══════════════════════════════════════════════
// 安全修復回歸測試（2026-10 紅隊報告 H-1/H-2/M-1/M-3/L-1/L-2）
// ══════════════════════════════════════════════
const { resetLimitersForTests, hashPin, verifyPin, isLegacyPinHash } = await import('../src/auth.js')
resetLimitersForTests()
// 前段 admin settings 測試已把 ctx.env 註冊開關關掉 → 安全段明確開註冊的 ctx
const regCtx = { store, env: { ...ctx.env, SELF_HOST_ALLOW_REGISTER: true } }

console.log('== 安全標頭（M-3）==')
r = await req('GET', '/api/health')
check('health 帶 CSP', (r.headers?.['content-security-policy'] || '').includes("frame-ancestors 'none'"))
check('health 帶 X-Frame-Options=DENY', r.headers?.['x-frame-options'] === 'DENY')
check('health 帶 nosniff', r.headers?.['x-content-type-options'] === 'nosniff')
check('health 帶 Referrer-Policy', (r.headers?.['referrer-policy'] || '').includes('strict-origin'))
check('health 預設帶 X-Robots-Tag: noindex, nofollow', r.headers?.['x-robots-tag'] === 'noindex, nofollow')
process.env.NO_INDEX = '0'
const rAllow = await req('GET', '/api/health')
check('NO_INDEX=0 時無 X-Robots-Tag', !rAllow.headers?.['x-robots-tag'])
delete process.env.NO_INDEX

console.log('== CORS 不反射任意 Origin（H-1）==')
// 走 /api/selfhost/me（其 corsHeaders 取自 ctx.env.ALLOWED_ORIGINS）
// 白名單 * → 一律回字面 *，不反射 evil origin
r = await req('GET', '/api/selfhost/me', { headers: { Origin: 'https://evil.example.com' } })
check('* 時不反射任意 origin → *', r.headers?.['access-control-allow-origin'] === '*', r.headers?.['access-control-allow-origin'])
// 白名單明確 → 命中回 origin + Vary，未命中不回 ACAO
const strictCtx = { store, env: { ...env, BACKUP_RETENTION_COUNT: 5, SELF_HOST_ALLOW_REGISTER: true, ALLOWED_ORIGINS: 'https://app.example.com' } }
r = await req('GET', '/api/selfhost/me', { headers: { Origin: 'https://evil.example.com' } }, strictCtx)
check('白名單未命中 → 無 ACAO', !r.headers?.['access-control-allow-origin'], r.headers?.['access-control-allow-origin'])
r = await req('GET', '/api/selfhost/me', { headers: { Origin: 'https://app.example.com' } }, strictCtx)
check('白名單命中 → 回該 origin + Vary', r.headers?.['access-control-allow-origin'] === 'https://app.example.com' && (r.headers?.['vary'] || '').includes('Origin'), r.headers)

console.log('== PIN scrypt + 舊 hash 升級（H-2）==')
{
    const legacy = (await import('node:crypto')).createHash('sha256').update('legacy-pin-1').digest('hex')
    check('舊 sha256 hash 辨識', isLegacyPinHash(legacy))
    const u = await store.createUser('legacyuser', legacy)
    const before = (await store.getUserByUsername('legacyuser')).pin_hash
    check('舊格式入庫', isLegacyPinHash(before))
    const { ok, needsUpgrade } = await verifyPin('legacy-pin-1', before)
    check('舊 hash 驗證 ok + 標記升級', ok === true && needsUpgrade === true)
    // 經 verifyLogin 觸發自動升級
    const u2 = await store.verifyLogin('legacyuser', 'legacy-pin-1')
    check('verifyLogin 舊 PIN 成功', !!u2)
    const after = (await store.getUserByUsername('legacyuser')).pin_hash
    check('登入後 hash 已升級為 scrypt', after.startsWith('scrypt$'), after.slice(0, 20))
    const u3 = await store.verifyLogin('legacyuser', 'legacy-pin-1')
    check('升級後仍可登入', !!u3)
    const u4 = await store.verifyLogin('legacyuser', 'wrong-pin')
    check('升級後錯 PIN → null', !u4)
    const h = await hashPin('fresh-pin')
    check('hashPin 含隨機鹽（scrypt$ 格式）', /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/.test(h))
    void u
}

console.log('== login 限速（H-2）==')
{
    await req('POST', '/api/selfhost/register', { body: { username: 'bruteforce', pin: 'bf-good-pin', deviceId: 'dev_bf_001' } }, regCtx)
    let last = null
    for (let i = 0; i < 12; i++) {
        last = await req('POST', '/api/selfhost/login', { body: { username: 'bruteforce', pin: 'bad-pin-xx' } })
    }
    check('連續失敗後 → 429', last.status === 429, last.status)
    check('429 帶 Retry-After', Number(last.headers?.['retry-after']) > 0, last.headers?.['retry-after'])
    // 不同帳號不受影響
    r = await req('POST', '/api/selfhost/login', { body: { username: 'alice', pin: 'secret-pin' } })
    check('限速按帳號隔離（alice 可登入）', r.status === 200, r.status)
    resetLimitersForTests()
}

console.log('== 註冊錯 PIN 統一訊息（L-1）==')
r = await req('POST', '/api/selfhost/register', { body: { username: 'alice', pin: 'definitely-wrong' } }, regCtx)
check('已存在+錯 PIN → 401 且訊息與 login 相同', r.status === 401 && r.json.error === 'Invalid username or PIN', r.json)
resetLimitersForTests()

console.log('== lookup 非成員不回 name/uuid（M-1）==')
{
    // carol 建立帳本，dave 非成員
    r = await req('POST', '/api/selfhost/register', { body: { username: 'carol2', pin: 'carol2-pin-1' } }, regCtx)
    const carolT = r.json.token
    r = await req('POST', '/api/selfhost/register', { body: { username: 'dave2', pin: 'dave2-pin-1' } }, regCtx)
    const daveT = r.json.token
    const LUUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    r = await req('POST', '/api/selfhost/shared', { body: { ledgerUuid: LUUID, name: '老王房貸分期', content: { deviceId: 'd_c', timestamp: 1, changes: [] } }, token: carolT })
    check('建立測試共用帳本', r.status === 201, r.status)
    r = await req('GET', `/api/selfhost/shared/lookup?code=${LUUID}`, { token: daveT })
    check('非成員 lookup → found=true 但無 uuid/name', r.json.found === true && r.json.uuid === undefined && r.json.name === undefined, r.json)
    r = await req('GET', `/api/selfhost/shared/lookup?code=${LUUID}`, { token: carolT })
    check('成員 lookup → 附 uuid+name', r.json.uuid === LUUID && r.json.name === '老王房貸分期', r.json)
    r = await req('GET', '/api/selfhost/shared/lookup?code=ffffffff', { token: daveT })
    check('不存在 → found=false', r.json.found === false)
    // lookup 限速
    let lr = null
    for (let i = 0; i < 35; i++) {
        lr = await req('GET', '/api/selfhost/shared/lookup?code=deadbeef', { token: daveT })
    }
    check('lookup 30 次/分鐘限速 → 429', lr.status === 429, lr.status)
    resetLimitersForTests()
}

console.log('== 偽造標頭無法繞過限速 ==')
{
    await req('POST', '/api/selfhost/register', { body: { username: 'hdr_target', pin: 'good-pin-123' } }, regCtx)
    let lastStatus = 0
    for (let i = 0; i < 15; i++) {
        // 嘗試帶不同偽造標頭繞過
        const res = await req('POST', '/api/selfhost/login', {
            body: { username: 'hdr_target', pin: 'wrong-pin' },
            headers: {
                'x-real-ip-trusted': `192.168.1.${i}`,
                'x-forwarded-for': `10.0.0.${i}`,
                'x-real-ip': `172.16.0.${i}`,
            },
        })
        lastStatus = res.status
    }
    check('帶隨機偽造標頭依然被限速 (429)', lastStatus === 429, lastStatus)
    resetLimitersForTests()
}

console.log('== 註冊 IP 頻率限制 (防批量註冊) ==')
{
    let regStatus = 0
    for (let i = 0; i < 15; i++) {
        const res = await req('POST', '/api/selfhost/register', {
            body: { username: `bulk_user_${i}`, pin: 'bulk-pin-123' },
        }, regCtx)
        regStatus = res.status
    }
    check('同 IP 連續註冊不同帳號觸發限流 (429)', regStatus === 429, regStatus)
    resetLimitersForTests()
}

console.log('== 跨帳號 Device ID 衝突防護 (409) ==')
{
    const u1 = await req('POST', '/api/selfhost/register', { body: { username: 'dev_owner_a', pin: 'pin-a-1234' } }, regCtx)
    const u2 = await req('POST', '/api/selfhost/register', { body: { username: 'dev_owner_b', pin: 'pin-b-1234' } }, regCtx)
    const devId = 'device_conflict_unique_01'
    
    // User A 註冊該裝置
    const regA = await req('POST', '/api/selfhost/devices/register', { body: { deviceId: devId }, token: u1.json.token })
    check('帳號 A 註冊裝置成功 (200)', regA.status === 200, regA.status)

    // User B 嘗試註冊同一個裝置
    const regB = await req('POST', '/api/selfhost/devices/register', { body: { deviceId: devId }, token: u2.json.token })
    check('帳號 B 跨帳號註冊同一裝置回報 409 Conflict', regB.status === 409, regB.status)
    resetLimitersForTests()
}

console.log('== 共用帳本空 changes 不抹除既有同步歷史 ==')
{
    const u = await req('POST', '/api/selfhost/register', { body: { username: 'shared_hist_user', pin: 'hist-pin-123' } }, regCtx)
    const t = u.json.token
    const shUuid = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
    
    // 建立共用帳本
    await req('POST', '/api/selfhost/shared', {
        body: {
            ledgerUuid: shUuid,
            name: '歷史保護帳本',
            content: {
                deviceId: 'dev_sh_01',
                timestamp: 100,
                changes: [
                    { deviceId: 'dev_sh_01', timestamp: 101, operation: 'add', storeName: 'records', recordId: 'r1', data: { amount: 100 } },
                    { deviceId: 'dev_sh_01', timestamp: 102, operation: 'add', storeName: 'records', recordId: 'r2', data: { amount: 200 } },
                ],
            },
        },
        token: t,
    })

    // 送出空的 changes 陣列
    const putRes = await req('PUT', `/api/selfhost/shared/${shUuid}`, {
        body: {
            content: {
                deviceId: 'dev_sh_01',
                timestamp: 200,
                changes: [],
            },
        },
        token: t,
    })
    check('PUT 空 changes 回應 200', putRes.status === 200, putRes.status)

    // 重新取得共用帳本，驗證歷史變更完整保留
    const getRes = await req('GET', `/api/selfhost/shared/${shUuid}`, { token: t })
    check('共用帳本變更數量未被抹除 (依舊為 2 筆)', getRes.json?.content?.changes?.length === 2, getRes.json?.content?.changes?.length)
    resetLimitersForTests()
}

console.log('== 併發推送變更不丟失 ==')
{
    const u = await req('POST', '/api/selfhost/register', { body: { username: 'concurrent_user', pin: 'conc-pin-123' } }, regCtx)
    const t = u.json.token
    const devId = 'concurrent_dev_01'
    await req('POST', '/api/selfhost/devices/register', { body: { deviceId: devId }, token: t })

    // 模擬兩個併發請求同時推送不同變更到同一個 deviceId
    const batch1 = [
        { deviceId: devId, timestamp: 1001, operation: 'add', storeName: 'records', recordId: 'c1', data: { amount: 10 } },
        { deviceId: devId, timestamp: 1002, operation: 'add', storeName: 'records', recordId: 'c2', data: { amount: 20 } },
    ]
    const batch2 = [
        { deviceId: devId, timestamp: 1003, operation: 'add', storeName: 'records', recordId: 'c3', data: { amount: 30 } },
        { deviceId: devId, timestamp: 1004, operation: 'add', storeName: 'records', recordId: 'c4', data: { amount: 40 } },
    ]

    const [res1, res2] = await Promise.all([
        req('POST', '/api/selfhost/push', { body: { deviceId: devId, changes: batch1 }, token: t }),
        req('POST', '/api/selfhost/push', { body: { deviceId: devId, changes: batch2 }, token: t }),
    ])

    check('併發請求 1 成功', res1.status === 200, res1.status)
    check('併發請求 2 成功', res2.status === 200, res2.status)

    const finalLog = await store.getDeviceLog(devId)
    const parsedLog = JSON.parse(finalLog.content)
    check('併發推送後 4 筆變更全數保存', parsedLog.changes.length === 4, parsedLog.changes.length)
    resetLimitersForTests()
}

console.log('== 並行登入暴力猜解防護 ==')
{
    resetLimitersForTests()
    const targetUser = 'victim_user'
    await req('POST', '/api/selfhost/register', { body: { username: targetUser, pin: 'real-password-123' } }, regCtx)
    resetLimitersForTests()

    // 模擬 30 個並行錯誤 PIN 猜解請求
    const attempts = Array.from({ length: 30 }, (_, i) =>
        req('POST', '/api/selfhost/login', { body: { username: targetUser, pin: `wrong-pin-${i}` } })
    )
    const results = await Promise.all(attempts)
    const count401 = results.filter(r => r.status === 401).length
    const count429 = results.filter(r => r.status === 429).length

    check('並行暴力破解中 401 數量受限（<= 11）', count401 <= 11, count401)
    check('並行暴力破解其餘請求被 429 阻擋（>= 19）', count429 >= 19, count429)
    resetLimitersForTests()
}

console.log('== 並行建立共用帳本競態條件防護 ==')
{
    const u1 = await req('POST', '/api/selfhost/register', { body: { username: 'creator_a', pin: 'pin-a-123' } }, regCtx)
    const u2 = await req('POST', '/api/selfhost/register', { body: { username: 'creator_b', pin: 'pin-b-123' } }, regCtx)
    const raceUuid = 'cccccccc-dddd-4eee-8fff-000000000001'

    const [create1, create2] = await Promise.all([
        req('POST', '/api/selfhost/shared', {
            body: { ledgerUuid: raceUuid, name: '帳本 A', content: { changes: [{ id: 'a1' }] } },
            token: u1.json.token,
        }),
        req('POST', '/api/selfhost/shared', {
            body: { ledgerUuid: raceUuid, name: '帳本 B', content: { changes: [{ id: 'b1' }] } },
            token: u2.json.token,
        }),
    ])

    const statuses = [create1.status, create2.status].sort()
    check('並行建立共用帳本：一筆 201 成功，另一筆 409 衝突', statuses[0] === 201 && statuses[1] === 409, statuses)

    // 驗證獲勝者的所有權與內容未被覆寫
    const winnerToken = create1.status === 201 ? u1.json.token : u2.json.token
    const winnerName = create1.status === 201 ? '帳本 A' : '帳本 B'
    const ledger = await req('GET', `/api/selfhost/shared/${raceUuid}`, { token: winnerToken })
    check('獲勝者帳本名稱完整保留', ledger.json.name === winnerName, ledger.json.name)
    resetLimitersForTests()
}

console.log('== 註冊時裝置衝突返回 409 ==')
{
    const dConfId = 'dev_conflict_001'
    const r1 = await req('POST', '/api/selfhost/register', {
        body: { username: 'dev_user_1', pin: 'pin-dev-1', deviceId: dConfId },
    }, regCtx)
    check('帳號 1 註冊並綁定裝置成功', r1.status === 201, r1.status)

    const r2 = await req('POST', '/api/selfhost/register', {
        body: { username: 'dev_user_2', pin: 'pin-dev-2', deviceId: dConfId },
    }, regCtx)
    check('帳號 2 註冊相同裝置返回 409 Conflict', r2.status === 409 && r2.json.error.includes('Device belongs to another account'), r2.json)
    resetLimitersForTests()
}

console.log('== 並行同名註冊防 500 ==')
{
    const sameUsername = 'race_user_same'
    const [regA, regB] = await Promise.all([
        req('POST', '/api/selfhost/register', { body: { username: sameUsername, pin: 'pin-same-1' } }, regCtx),
        req('POST', '/api/selfhost/register', { body: { username: sameUsername, pin: 'pin-same-2' } }, regCtx),
    ])
    const regStatuses = [regA.status, regB.status].sort()
    check('並行同名註冊：一筆 201，另一筆 409（無 500）', regStatuses[0] === 201 && regStatuses[1] === 409, regStatuses)
    resetLimitersForTests()
}

console.log('== clientIp 與 TRUST_PROXY 標頭解析 ==')
{
    const { clientIp } = await import('../src/auth.js')
    const reqSocket = new Request('http://localhost:8080/api/health', {
        headers: { 'x-socket-remote-address': '192.168.1.100' },
    })
    check('預設採用 socket remote address', clientIp(reqSocket) === '192.168.1.100')

    const reqSpoofed = new Request('http://localhost:8080/api/health', {
        headers: {
            'x-forwarded-for': '1.2.3.4',
            'x-socket-remote-address': '192.168.1.100',
        },
    })
    check('未開 TRUST_PROXY 時忽略偽造 XFF', clientIp(reqSpoofed) === '192.168.1.100')

    process.env.TRUST_PROXY = '1'
    const reqProxied = new Request('http://localhost:8080/api/health', {
        headers: {
            'x-forwarded-for': '1.2.3.4, 203.0.113.195',
            'x-socket-remote-address': '127.0.0.1',
        },
    })
    check('開啟 TRUST_PROXY 時採信最右側真實客戶端 IP', clientIp(reqProxied) === '203.0.113.195')

    const reqDirectExternal = new Request('http://localhost:8080/api/health', {
        headers: {
            'x-forwarded-for': '1.1.1.1',
            'cf-connecting-ip': '2.2.2.2',
            'x-real-ip': '3.3.3.3',
            'x-socket-remote-address': '198.51.100.25', // 公網外部直連 IP
        },
    })
    check('公網直連繞過反代時拒絕採信偽造代理標頭', clientIp(reqDirectExternal) === '198.51.100.25')
    delete process.env.TRUST_PROXY
}

console.log('== RateLimiter 防容量淘汰洗白鎖定狀態 ==')
{
    const { RateLimiter } = await import('../src/auth.js')
    const limiter = new RateLimiter({ max: 2, lockMs: 60000 })
    limiter.recordFailure('victim_user')
    limiter.recordFailure('victim_user')
    limiter.recordFailure('victim_user') // locked
    check('victim_user 已被鎖定', limiter.check('victim_user') !== null)

    for (let i = 0; i < 10005; i++) {
        limiter._m.set(`attacker_${i}`, { fails: 5, windowStart: Date.now(), lockedUntil: Date.now() + 60000 })
    }
    limiter.recordFailure('attacker_new')
    check('容量達上限時不淘汰鎖定中目標', limiter.check('victim_user') !== null)
}

console.log('== 註冊流程原子性（裝置衝突回滾使用者）==')
{
    const devOcc = 'dev_occupied_999'
    await req('POST', '/api/selfhost/register', { body: { username: 'owner_user', pin: 'pin-123', deviceId: devOcc } }, regCtx)

    const rFail = await req('POST', '/api/selfhost/register', { body: { username: 'rollback_user', pin: 'pin-123', deviceId: devOcc } }, regCtx)
    check('裝置衝突回報 409', rFail.status === 409)

    const checkUser = await store.getUserByUsername('rollback_user')
    check('使用者未殘留在資料庫（交易已原子回滾）', checkUser === null, checkUser)
    resetLimitersForTests()
}

console.log('== 成功登入清零 IP 限速計數 ==')
{
    resetLimitersForTests()
    await req('POST', '/api/selfhost/register', { body: { username: 'frequent_user', pin: 'freq-pin-123' } }, regCtx)
    let ok = true
    for (let i = 0; i < 35; i++) {
        const res = await req('POST', '/api/selfhost/login', { body: { username: 'frequent_user', pin: 'freq-pin-123' } })
        if (res.status !== 200) {
            ok = false
            break
        }
    }
    check('同一 IP 連續成功登入 35 次不被 429 阻擋', ok)
    resetLimitersForTests()
}

console.log('== POST /logout 撤銷 Token ==')
{
    const regRes = await req('POST', '/api/selfhost/register', { body: { username: 'logout_user', pin: 'pin-logout' } }, regCtx)
    const token = regRes.json.token
    const authH = { Authorization: `Bearer ${token}` }

    const meBefore = await req('GET', '/api/selfhost/me', { headers: authH })
    check('登出前 Token 有效', meBefore.status === 200)

    const logoutRes = await req('POST', '/api/selfhost/logout', { headers: authH })
    check('logout 回傳 200 success', logoutRes.status === 200 && logoutRes.json.success === true)

    const meAfter = await req('GET', '/api/selfhost/me', { headers: authH })
    check('登出後 Token 失效回傳 401', meAfter.status === 401)
    resetLimitersForTests()
}

console.log('== 帳號級防護不硬鎖合法使用者（Anti-DoS）==')
{
    await req('POST', '/api/selfhost/register', { body: { username: 'dos_target', pin: 'target-pin-456' } }, regCtx)
    const { accountLoginLimiter } = await import('../src/auth.js')
    for (let i = 0; i < 20; i++) {
        accountLoginLimiter.recordFailure('dos_target')
    }
    check('帳號已處於全域失敗高發狀態', accountLoginLimiter.check('dos_target') !== null)

    const loginRes = await req('POST', '/api/selfhost/login', { body: { username: 'dos_target', pin: 'target-pin-456' } })
    check('合法使用者輸入正確 PIN 依然能成功登入 (200)', loginRes.status === 200)
    check('成功登入後清空帳號限速懲罰', accountLoginLimiter.check('dos_target') === null)
    resetLimitersForTests()
}

console.log('== 備份使用者總容量配額防護 ==')
{
    const regUser = await req('POST', '/api/selfhost/register', { body: { username: 'quota_user', pin: 'pin-quota' } }, regCtx)
    const token = regUser.json.token
    const authH = { Authorization: `Bearer ${token}` }

    // 模擬已佔滿配額
    const smallContent = JSON.stringify({ test: 'quota' })
    await store.putBackup(regUser.json.username === 'quota_user' ? (await store.getUserByUsername('quota_user')).id : 1, 'dev_1', 'dummy.json', smallContent, 501 * 1024 * 1024)

    const overRes = await req('POST', '/api/selfhost/backup', {
        headers: authH,
        body: { fileName: 'exceed.json', content: smallContent, size: 1024 }
    })
    check('超過總配額時回報 413 Payload Too Large', overRes.status === 413)
    resetLimitersForTests()
}

store.close()
console.log(`\n===== ${passed} passed, ${failed} failed =====`)
process.exit(failed > 0 ? 1 : 0)

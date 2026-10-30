/**
 * Easy Accounting Sync Server — Admin CLI
 *
 * 直接操作 SQLite DB（不需啟動 server），供 docker exec / 本機管理帳號使用。
 * 需 Node.js >= 22.5（node:sqlite）。
 *
 * 用法（皆需 SELF_HOST_ADMIN_TOKEN 環境變數）：
 *   node src/admin-cli.js list
 *   node src/admin-cli.js create --username bob --pin secret123
 *   node src/admin-cli.js reset-pin --username bob --pin newsecret
 *   node src/admin-cli.js delete --username bob
 *   node src/admin-cli.js set-register --enable | --disable
 *
 * 安全注意：
 * - create / reset-pin 的 PIN 會出現在 shell 歷史與 process list，
 *   建議用 `--pin-file <path>` 改從檔案讀取（首行內容）。
 * - 本 CLI 只管理「帳號」；共用帳本（shared ledger）的管理請用
 *   admin token 走 HTTP API（/api/selfhost/shared/*）。
 */

import { SqliteStore } from './db.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// 壓掉 node:sqlite 的 ExperimentalWarning（CLI 體驗）
process.removeAllListeners('warning')
process.on('warning', w => {
    if (w.name === 'ExperimentalWarning') return
    console.warn(w)
})

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/

function sha256Hex(input) {
    return createHash('sha256').update(String(input)).digest('hex')
}

// PIN 派生與 server 端一致（scrypt；auth.js 為共用實作）
const { hashPin } = await import('./auth.js')

function parseArgs(argv) {
    const args = { _: [] }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '--username') args.username = argv[++i]
        else if (a === '--pin') args.pin = argv[++i]
        else if (a === '--pin-file') {
            const p = argv[++i]
            args.pin = readFileSync(p, 'utf8').split('\n')[0].replace(/\r$/, '')
        } else if (a === '--enable') args.enable = true
        else if (a === '--disable') args.disable = true
        else args._.push(a)
    }
    return args
}

function fail(msg) {
    console.error(`❌ ${msg}`)
    process.exit(1)
}

async function main() {
    const dbPath = process.env.SELF_HOST_DB_PATH || './data/jijun.db'
    const args = parseArgs(process.argv.slice(2))
    const [command] = args._

    if (!command) {
        console.log(
            `用法:
  node src/admin-cli.js list
  node src/admin-cli.js create --username <name> --pin <pin> | --pin-file <path>
  node src/admin-cli.js reset-pin --username <name> --pin <pin> | --pin-file <path>
  node src/admin-cli.js delete --username <name>
  node src/admin-cli.js set-register --enable | --disable

環境變數：SELF_HOST_DB_PATH（預設 ./data/jijun.db）`
        )
        process.exit(command ? 0 : 1)
    }

    const store = new SqliteStore(dbPath)
    await store.init()

    switch (command) {
        case 'list': {
            const users = await store.listUsers()
            if (users.length === 0) {
                console.log('（無帳號）')
                break
            }
            console.log(
                'username       isAdmin  devices  createdAt'
            )
            for (const u of users) {
                const created = new Date(u.created_at).toISOString().slice(0, 10)
                console.log(
                    `  ${u.username.padEnd(14)} ${u.is_admin ? 'yes' : 'no'.padEnd(5)} ${String(u.device_count).padEnd(8)} ${created}`
                )
            }
            const reg = await store.getMeta('allow_register')
            console.log(
                `\n公開註冊：${reg === null ? '（依 env SELF_HOST_ALLOW_REGISTER，未覆寫）' : reg === '1' ? '開啟' : '關閉（DB 覆寫）'}`
            )
            break
        }
        case 'create': {
            if (!USERNAME_RE.test(args.username || '')) {
                fail('username 需 2-32 字元（英數字/_/-）')
            }
            if (!args.pin || args.pin.length < 4 || args.pin.length > 64) {
                fail('PIN 需 4-64 字元')
            }
            const existing = await store.getUserByUsername(args.username)
            if (existing) fail(`username "${args.username}" 已存在`)
            const user = await store.createUserAsAdmin(
                args.username,
                await hashPin(args.pin),
                false
            )
            console.log(`✅ 已建立帳號 "${user.username}"`)
            console.log(`   PIN: ${args.pin}  ← 請立即告知該使用者並改存他處（此後無法再查）`)
            break
        }
        case 'reset-pin': {
            if (!USERNAME_RE.test(args.username || '')) {
                fail('username 需 2-32 字元（英數字/_/-）')
            }
            if (!args.pin || args.pin.length < 4 || args.pin.length > 64) {
                fail('PIN 需 4-64 字元')
            }
            const target = await store.getUserByUsername(args.username)
            if (!target) fail(`找不到帳號 "${args.username}"`)
            await store.resetUserPin(target.id, await hashPin(args.pin))
            console.log(`✅ "${args.username}" PIN 已重置`)
            console.log(`   新 PIN: ${args.pin}  ← 請告知該使用者（舊 PIN 立即失效）`)
            break
        }
        case 'delete': {
            if (!USERNAME_RE.test(args.username || '')) {
                fail('username 需 2-32 字元（英數字/_/-）')
            }
            const target = await store.getUserByUsername(args.username)
            if (!target) fail(`找不到帳號 "${args.username}"`)
            if (target.username === 'admin' && target.is_admin) {
                fail('不能刪除 bootstrap admin 帳號')
            }
            await store.deleteUser(target.id)
            console.log(`✅ 已刪除帳號 "${args.username}"（含其裝置、同步 log、備份、共用帳本成員關係）`)
            break
        }
        case 'set-register': {
            const enable = !!args.enable
            await store.setMeta('allow_register', enable ? '1' : '0')
            console.log(`✅ 公開註冊已${enable ? '開啟' : '關閉'}（DB 覆寫，優先於 env；重啟後仍生效）`)
            break
        }
        default:
            fail(`未知指令 "${command}"（可用：list / create / reset-pin / delete / set-register）`)
    }

    store.close()
}

main().catch(err => {
    console.error('❌', err.message)
    process.exit(1)
})

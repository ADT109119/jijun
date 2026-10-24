// standalone.js 真實 HTTP 冒煙測試
// 需要 Node.js >= 22.5（node:sqlite），子程序使用與測試相同的 node 執行檔
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const workdir = mkdtempSync(join(tmpdir(), 'jijun-selfhost-'))
const standalonePath = join(fileURLToPath(new URL('..', import.meta.url)), 'src', 'standalone.js')
mkdirSync(join(workdir, 'data'), { recursive: true })
mkdirSync(join(workdir, 'dist'), { recursive: true })
writeFileSync(join(workdir, 'dist', 'index.html'), '<html><body>JIJUN_STATIC_OK</body></html>')
writeFileSync(join(workdir, 'dist', 'asset.js'), 'console.log("asset")')

const port = 8791
const child = execFile(
  process.execPath,
  [standalonePath],
  {
    cwd: workdir,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      SELF_HOST_ADMIN_TOKEN: 'bootstrap-pin123',
      DISABLE_GOOGLE_OAUTH: '1',
      PORT: String(port),
      SELF_HOST_DB_PATH: './data/test.db',
      SELF_HOST_STATIC_DIR: './dist',
    },
  },
  (err, stdout, stderr) => {
    if (err) {
      console.log('process exited early:', err.message)
    }
    console.log('--- stdout ---\n' + stdout)
    console.log('--- stderr ---\n' + stderr)
  }
)

const base = `http://localhost:${port}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function get(path, token) {
  const r = await fetch(base + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const headers = {}
  r.headers.forEach((v, k) => { headers[k] = v })
  return { status: r.status, text: await r.text(), headers }
}
async function post(path, body, token) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) {}
  return { status: r.status, json, text }
}

let passed = 0, failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name) }
  else { failed++; console.log('  FAIL  ' + name, extra ?? '') }
}

try {
  // 等 server 起來
  let up = false
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    try {
      const r = await get('/api/health')
      if (r.status === 200) { up = true; break }
    } catch (_) {}
  }
  check('server 啟動 + /api/health', up, 'no health')
  const health = await get('/api/health')
  check('health.selfHosted=true', JSON.parse(health.text).selfHosted === true, health.text)

  // 靜態伺服
  const idx = await get('/')
  check('靜態 index.html', idx.status === 200 && idx.text.includes('JIJUN_STATIC_OK'), idx.text.slice(0, 80))
  check('靜態 index.html 帶 meta robots noindex', idx.text.includes('<meta name="robots" content="noindex, nofollow" />'))
  check('靜態 index.html 帶 x-robots-tag', idx.headers['x-robots-tag'] === 'noindex, nofollow')

  const spa = await get('/records')
  check('SPA fallback → index.html', spa.status === 200 && spa.text.includes('JIJUN_STATIC_OK'), spa.status)
  check('SPA fallback 帶 meta robots noindex', spa.text.includes('<meta name="robots" content="noindex, nofollow" />'))

  // 爬蟲控制 (NO_INDEX 預設)
  const robots = await get('/robots.txt')
  check('GET /robots.txt 200', robots.status === 200)
  check('robots.txt 包含 Disallow: /', robots.text.includes('Disallow: /') && robots.text.includes('User-agent: *'))
  check('robots.txt 帶 x-robots-tag', robots.headers['x-robots-tag'] === 'noindex, nofollow')

  // bootstrap admin (admin / bootstrap-pin123)
  const login = await post('/api/selfhost/login', { username: 'admin', pin: 'bootstrap-pin123' })
  check('bootstrap admin 可登入 (admin / SELF_HOST_ADMIN_TOKEN)', login.status === 200 && login.json.token, login.json || login.text)
  const token = login.json?.token

  const badLogin = await post('/api/selfhost/login', { username: 'admin', pin: 'wrong' })
  check('錯誤 PIN → 401', badLogin.status === 401, badLogin.status)

  // push/pull 走真實 HTTP
  const push = await post('/api/selfhost/push', {
    deviceId: 'dev_http_test_1',
    changes: [{ operation: 'add', storeName: 'records', recordId: 1, data: { uuid: 'u1' }, timestamp: Date.now() }],
  }, token)
  check('HTTP push 200', push.status === 200 && push.json.total === 1, push.json)
  const pull = await get('/api/selfhost/pull', token)
  check('HTTP pull 有 1 裝置 1 變更', pull.status === 200 && JSON.parse(pull.text).devices.length === 1, pull.text)
} finally {
  child.kill('SIGTERM')
}

console.log(`\n===== ${passed} passed, ${failed} failed =====`)
process.exit(failed > 0 ? 1 : 0)

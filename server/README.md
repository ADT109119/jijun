# Easy Accounting Sync Server

輕鬆記帳的雲端同步伺服器，有兩種模式（可同時啟用）：

1. **Google OAuth Proxy**（既有）— 僅代理 Google OAuth Token Exchange（因 `client_secret` 不能暴露在前端），不儲存任何使用者資料；Google Drive 版同步資料由前端直接存取 `appDataFolder`。
2. **純自架同步（Self-Hosted Sync）**（#63 起）— 用自己的 **SQLite** 資料庫儲存多裝置同步 change log、備份 JSON 與**跨帳號共用帳本**，**不綁 Google 帳號**。公開註冊**預設關閉**（只有 admin 能建帳號）。部署、廣告關閉（`AD_FREE=1`）、前端驗證碼（`ACCESS_CODE`）、帳號管理（admin API / CLI）、共用帳本等完整說明見 repo 根目錄 **[SELF_HOST.md](../SELF_HOST.md)**。

> **前後端一體**：Docker image 已內建前端 build（多階段 build；預設 `AD_FREE=1` 無廣告、可注入 `ACCESS_CODE`）。啟動後同一 port 即提供前端 + API。

## 端點

### Self-Hosted Sync（`SELF_HOST_ADMIN_TOKEN` 設定後啟用）

| Method | Path | 說明 |
| ------ | ---- | ---- |
| `POST` | `/api/selfhost/register` | 註冊帳號（`{username, pin, deviceId?}`）。**公開註冊預設關閉 → `403`**（`SELF_HOST_ALLOW_REGISTER=1` 或 admin runtime 切換才開放） |
| `POST` | `/api/selfhost/login` | 登入（`{username, pin}`） |
| `GET` | `/api/selfhost/me` | 帳號資訊 + 裝置列表 |
| `POST` | `/api/selfhost/devices/register` | 註冊裝置 |
| `POST` | `/api/selfhost/push` | 推送變更（≤5000 筆/批） |
| `GET` | `/api/selfhost/pull` | 拉取其他裝置變更（`?since=<ts>&deviceId=<id>`） |
| `POST` | `/api/selfhost/backup` | 存備份 |
| `GET` | `/api/selfhost/backups` | 備份列表 |
| `GET` | `/api/selfhost/backups/:id` | 取備份 |
| `DELETE` | `/api/selfhost/backups/:id` | 刪備份 |

### Admin（需 admin token：bootstrap admin 登入的 token；非 admin → `403`）

| Method | Path | 說明 |
| ------ | ---- | ---- |
| `POST` | `/api/selfhost/admin/users` | 建立帳號（`{username, pin}`）→ pin 僅回傳一次 |
| `GET` | `/api/selfhost/admin/users` | 帳號列表（`isAdmin` / `deviceCount` / `registerEnabled`） |
| `POST` | `/api/selfhost/admin/users/:username/reset-pin` | 重置 PIN |
| `DELETE` | `/api/selfhost/admin/users/:username` | 刪除帳號（含裝置/log/備份；bootstrap admin 不可刪） |
| `PUT` | `/api/selfhost/admin/settings/register` | 公開註冊開關（DB 覆寫 env） |

### Shared Ledgers（跨帳號共用帳本）

| Method | Path | 說明 |
| ------ | ---- | ---- |
| `POST` | `/api/selfhost/shared` | 建立（`{ledgerUuid, name, content}`；建立者 = owner） |
| `GET` | `/api/selfhost/shared` | 列出我的 |
| `GET` | `/api/selfhost/shared/:uuid` | 讀 content（成員） |
| `PUT` | `/api/selfhost/shared/:uuid` | 覆寫 content（成員；完整比對式 log） |
| `DELETE` | `/api/selfhost/shared/:uuid` | 刪除（owner） |
| `GET` | `/api/selfhost/shared/lookup?code=<uuid 或前 8 字>` | 解析共用代碼 |
| `GET` | `/api/selfhost/shared/:uuid/members` | 成員列表（`{members, isOwner}`） |
| `POST` | `/api/selfhost/shared/:uuid/members` | 邀請帳號（owner） |
| `DELETE` | `/api/selfhost/shared/:uuid/members/:username` | 移除成員（owner） |

### Google OAuth Proxy

| Method | Path                | 說明                              |
| ------ | ------------------- | --------------------------------- |
| `POST` | `/api/auth/token`   | Authorization Code → Access Token |
| `POST` | `/api/auth/refresh` | Refresh Token → 新 Access Token   |
| `GET`  | `/api/health`       | 健康檢查（含 `selfHosted`、`registerEnabled` 欄位） |

---

## 部署方式

### 方式一：Docker（前後端一體，推薦自架）

```bash
# 1. 複製環境變數範本
cp .env.example .env
# SELF_HOST_ADMIN_TOKEN（自架）/ GOOGLE_CLIENT_ID+SECRET（OAuth proxy，可選）

# 2. 啟動（多階段 build：自動 build 前端 + server；前端預設 AD_FREE=1）
docker compose up -d --build

# 3. 管理帳號（免開 web；需 SELF_HOST_ADMIN_TOKEN env）
docker compose exec sync-server node src/admin-cli.js list
docker compose exec sync-server node src/admin-cli.js create --username wife --pin wife-secret-1
docker compose exec sync-server node src/admin-cli.js set-register --enable
```

前端 build 參數（`build.args`）：`AD_FREE`（預設 `1`）、`ACCESS_CODE`（前端驗證碼，可留空）。

### 方式二：Cloudflare Worker（僅 OAuth Proxy；`node:sqlite` 不可用，自架同步需 Docker/Node）

```bash
# 1. 安裝依賴
npm install

# 2. 設定 Secrets
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# 3. 部署
npm run deploy
```

### 方式三：Node.js 直接運行（需 Node.js ≥ 22.5，`node:sqlite`）

```bash
# 設定環境變數（純自架）
export SELF_HOST_ADMIN_TOKEN=*** rand -hex 32)
export DISABLE_GOOGLE_OAUTH=1

# 啟動
npm start
```

---

## Google Cloud Console 設定

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立專案，啟用 **Google Drive API**
3. 建立 **OAuth 2.0 Client ID**（Web application 類型）
4. 設定 **Authorized JavaScript origins**：
    - `https://jijun.adt109119.com`
    - `http://localhost:3000`（開發用）
5. 設定 **Authorized redirect URIs**：
    - `https://jijun.adt109119.com`
    - `http://localhost:3000`
6. 記下 `Client ID` 和 `Client Secret`

---

## GitHub 設定建議

### 獨立 Repo（推薦）

建議將此 server 作為獨立的 GitHub Repository：

```
easy-accounting-sync-server/
├── src/
│   ├── index.js
│   └── standalone.js
├── package.json
├── wrangler.toml
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

**好處**：

- CI/CD 獨立管理，前後端部署不互相影響
- Worker 部署可用 GitHub Actions 自動化
- 前端可以是靜態站點（GitHub Pages），後端是 Worker 或 Docker

### GitHub Actions CI/CD 範例

在 repo 中建立 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Cloudflare Workers
on:
    push:
        branches: [main]

jobs:
    deploy:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with:
                  node-version: '20'
            - run: npm install
            - run: npx wrangler deploy
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

需在 GitHub Repo → Settings → Secrets 中設定：

- `CLOUDFLARE_API_TOKEN` — Cloudflare API Token
- Worker 的 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET` 需透過 `wrangler secret put` 預先設定

### Monorepo（替代方案）

如果偏好 Monorepo，可將 `server/` 保留在主專案中，但需注意：

- `.gitignore` 中要排除 `server/node_modules`
- CI/CD 需設定路徑過濾，只有 `server/` 變更時才觸發部署

---

## 環境變數

| 變數名                 | 必要 | 說明                                     |
| ---------------------- | :--: | ---------------------------------------- |
| `GOOGLE_CLIENT_ID`     |  ✅  | Google OAuth Client ID                   |
| `GOOGLE_CLIENT_SECRET` |  ✅  | Google OAuth Client Secret               |
| `ALLOWED_ORIGINS`      |  ❌  | CORS 允許的 Origin（逗號分隔，預設 `*`） |
| `PORT`                 |  ❌  | Standalone 模式埠號（預設 `8787`）       |
| `SELF_HOST_ADMIN_TOKEN`|  ❌  | 設定了即啟用純自架同步（SQLite）；首次啟動建立 admin 帳號（PIN 即此值）。純自架模式必填 |
| `DISABLE_GOOGLE_OAUTH` |  ❌  | `1` = 停用 Google OAuth 路由（純自架模式可免 Google 憑證） |
| `SELF_HOST_DB_PATH`    |  ❌  | SQLite DB 路徑（預設 `./data/jijun.db`） |
| `SELF_HOST_STATIC_DIR` |  ❌  | 前端靜態目錄（預設 `/app/static`；Docker image 已內建前端） |
| `SELF_HOST_ALLOW_REGISTER` | ❌ | 公開註冊開關（`1` = 開放，預設 `0` 關閉；admin 可 runtime 切換，DB 覆寫此 env） |
| `BACKUP_RETENTION_COUNT` | ❌ | 每使用者備份保留筆數（預設 `100`）     |

> 純自架部署的完整指南（Docker / systemd / HTTPS / 故障排除）：[../SELF_HOST.md](../SELF_HOST.md)

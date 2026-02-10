# Easy Accounting Sync Server

輕鬆記帳的雲端同步伺服器 — **純 Google OAuth Proxy**。

此伺服器**僅負責**代理 Google OAuth Token Exchange（因為 `client_secret` 不能暴露在前端），不儲存任何使用者資料。所有同步資料皆透過前端直接存放於 Google Drive `appDataFolder`。

## 端點

| Method | Path | 說明 |
|--------|------|------|
| `POST` | `/api/auth/token` | Authorization Code → Access Token |
| `POST` | `/api/auth/refresh` | Refresh Token → 新 Access Token |
| `GET`  | `/api/health` | 健康檢查 |

---

## 部署方式

### 方式一：Cloudflare Worker（推薦）

```bash
# 1. 安裝依賴
npm install

# 2. 設定 Secrets
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# 3. 部署
npm run deploy
```

### 方式二：Docker

```bash
# 1. 複製環境變數範本
cp .env.example .env

# 2. 編輯 .env 填入你的 Google OAuth 憑證
# GOOGLE_CLIENT_ID=your-client-id
# GOOGLE_CLIENT_SECRET=your-client-secret

# 3. 啟動
docker compose up -d
```

### 方式三：Node.js 直接運行

```bash
# 設定環境變數
export GOOGLE_CLIENT_ID=your-client-id
export GOOGLE_CLIENT_SECRET=your-client-secret

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

| 變數名 | 必要 | 說明 |
|--------|:----:|------|
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth Client Secret |
| `ALLOWED_ORIGINS` | ❌ | CORS 允許的 Origin（逗號分隔，預設 `*`） |
| `PORT` | ❌ | Standalone 模式埠號（預設 `8787`） |

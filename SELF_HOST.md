# 純自架部署指南（Self-Hosted）

> 適用版本：v2.2.x 起（#63）
> 本文件說明如何把「輕鬆記帳」部署在自己的伺服器上：**前後端一體**（同一 port 提供前端 + API）、**資料儲存在自己的 SQLite 資料庫**（不綁 Google）、**廣告可完全關閉**、**可限制誰能註冊帳號**、**可加前端驗證碼**。

## 這是什麼 / 不是什麼

`server/` 目錄是一個 **Node.js 同步伺服器**，有兩種模式（可同時啟用）：

| 模式 | 作用 | 需要什麼 |
| ---- | ---- | -------- |
| 純自架同步（Self-Hosted Sync） | 儲存使用者記帳資料：多裝置同步 + 雲端備份 + 跨帳號共用帳本 | `SELF_HOST_ADMIN_TOKEN`（不綁 Google） |
| Google OAuth Proxy | 代理 Google OAuth token exchange，讓 web 版可以用 Google Drive 同步 | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |

- **純自架模式下不需要任何 Google 憑證**，資料全部存在你的 SQLite DB。
- **前後端一體**：Docker image 已內建前端 build（預設 `AD_FREE=1` 無廣告），啟動後直接瀏覽 `http://你的IP:8787/` 就是完整記帳應用。
- **公開註冊預設關閉**：只有管理員能建立帳號（web 設定頁「管理員：帳號管理」或 CLI），避免外部人士任意註冊。
- **跨帳號共用帳本**：家人各自帳號、各自隱私，但可共用同一本「家庭支出」帳本（見下方章節）。
- 預設使用 **SQLite**（`node:sqlite`，Node.js ≥ 22.5）。儲存層已抽象化（`server/src/db.js`），未來可換 PostgreSQL 等，路由層與前端不需更動。

---

## 快速開始（Docker，推薦）

```bash
# 1. 取得程式碼
git clone https://github.com/ADT109119/jijun.git
cd jijun

# 2. 設定環境變數
cd server
cp .env.example .env
# 編輯 .env：
#   - SELF_HOST_ADMIN_TOKEN：用隨機長字串，例如
#     openssl rand -hex 32
#   - DISABLE_GOOGLE_OAUTH=1（純自架模式）

# 3. 啟動（Dockerfile 多階段 build：自動 build 前端 + server）
docker compose up -d --build

# 4. 健康檢查
curl http://localhost:8787/api/health
# → {"status":"ok","service":"easy-accounting-sync","selfHosted":true,"registerEnabled":false,...}
```

訪問 `http://你的IP:8787/` 即可使用（前端 + API 同 port）。

**首次登入**：設定頁 →「自架同步（Self-Host）」→ 帳號 `admin`、PIN 碼即 `SELF_HOST_ADMIN_TOKEN` 的值 → 登入。
（管理員帳號在**首次啟動、DB 完全空白時**建立；公開註冊預設關閉，其他帳號由管理員建立。）

---

## 模式選擇：前後端一體 vs 僅自架後端（搭配官方託管前端）

本專案支援兩種自架方式，可依個人需求選擇：

### 模式 A：前後端一體自架（預設，推薦 NAS / 家用伺服器 / 純內網私有雲）
- **優勢**：Docker 一鍵啟動，前後端完全同源（同一 port），無跨域（CORS）問題，且在純內網（如 `http://192.168.1.100:8787`）也能順暢使用，不受瀏覽器 Mixed Content 限制。
- **存取方式**：直接在瀏覽器輸入 `http://你的IP:8787/`。

### 模式 B：僅自架後端 + 搭配官方託管前端（`https://jijun.the-walking-fish.com/`）
若你不想每次手動 build 前端，希望直接使用官方網頁版隨時獲取最新前端功能與介面，但**記帳資料 100% 儲存在自己的伺服器**：

1. **CORS 設定**：後端 `.env` 必須將 `ALLOWED_ORIGINS` 設為包含官方前端網址：
   ```bash
   ALLOWED_ORIGINS=https://jijun.the-walking-fish.com,http://localhost:3000
   ```
2. **⚠️ 關鍵安全性限制：HTTPS 與瀏覽器 Mixed Content**：
   - 官方前端為 **HTTPS**（`https://jijun.the-walking-fish.com/`）。
   - 現代瀏覽器（Chrome, Safari, Edge, Firefox）基於安全性政策，**嚴格封鎖 HTTPS 網頁向不安全的明文 HTTP (`http://...`) API 發出主動請求（Mixed Active Content）**！
   - 因此：若要在官方前端使用自架後端，**你的後端必須配置 HTTPS 網址**（例如透過 Caddy 自動憑證、Nginx 反代、Cloudflare Tunnel、Tailscale HTTPS 等，提供如 `https://sync.yourdomain.com`）。
   - *（例外：若在同一台電腦開發測試，瀏覽器將 `http://localhost:8787` 視為 Trustworthy Origin，允許從官方 HTTPS 前端直接跨來源連線。）*
3. **App 內連線步驟**：
   - 打開 [https://jijun.the-walking-fish.com/](https://jijun.the-walking-fish.com/)
   - 前往「設定」→「雲端備份&同步」
   - 在「伺服器設定」填入自架 HTTPS 網址（例如 `https://sync.yourdomain.com`）
   - 在「自架同步」點擊「測試伺服器連線」，連線成功後即可註冊或登入。

### 選配：前端存取驗證碼（ACCESS_CODE）

```bash
# 重新 build 時注入（compose 的 build.args，或）：
docker build -f server/Dockerfile \
  --build-arg AD_FREE=1 \
  --build-arg ACCESS_CODE=*** \
  -t jijun-selfhost .
```

每個瀏覽器 session 首次訪問都要輸入正確驗證碼才能使用 app。
⚠️ **定位：UX 門檻（防家人外借時外人翻帳本），非安全機制**——驗證碼會編進 JS bundle，懂技術者 F12 可取得。真要擋外部存取請用 reverse proxy（IP 白名單 / Basic Auth / VPN）。

---

## 環境變數完整清單（server）

| 變數 | 必要 | 預設 | 說明 |
| ---- | :--: | ---- | ---- |
| `SELF_HOST_ADMIN_TOKEN` | 自架模式 ✅ | — | 自架同步啟用開關 + bootstrap admin PIN。**必須 ≥16 字元，強烈建議隨機 64 hex（`openssl rand -hex 32`）**——它就是 `admin` 帳號的登入 PIN，過短會被暴力破解（server 啟動時少於 16 字元會印警告）。**首次啟動建立 admin 帳號（PIN 即此值）** |
| `DISABLE_GOOGLE_OAUTH` | 純自架 ✅ | `0` | `1` = 停用 Google OAuth 路由（不需 Google 憑證即可啟動） |
| `SELF_HOST_ALLOW_REGISTER` | ❌ | `0` | 公開註冊開關。`1` = 允許任何人註冊。admin 登入後可在 web 設定頁 runtime 切換（會覆寫此 env） |
| `GOOGLE_CLIENT_ID` | 僅 OAuth 模式 | — | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | 僅 OAuth 模式 | — | Google OAuth 2.0 Client Secret |
| `PORT` | ❌ | `8787` | 監聽埠號 |
| `SELF_HOST_DB_PATH` | ❌ | `./data/jijun.db` | SQLite 資料庫路徑（Docker 內建議 `/app/data/selfhost.db`，已掛 volume） |
| `SELF_HOST_STATIC_DIR` | ❌ | `/app/static` | 前端靜態目錄（image 已內建；要改用外部 dist 可改此值 + 掛 volume） |
| `BACKUP_RETENTION_COUNT` | ❌ | `100` | 每使用者備份保留筆數（超出自動刪最舊） |
| `ALLOWED_ORIGINS` | ❌ | `*` | CORS 允許的 origin，逗號分隔。**公網部署務必設為明確域名白名單**（見下方 HTTPS 反代章節） |

### 前端 build 參數（build-arg，非執行期 env）

| 參數 | 預設 | 說明 |
| ---- | ---- | ---- |
| `AD_FREE` | `1` | `1` = 移除所有廣告（AdSense / GPT / AdMob 完全不出現於 bundle） |
| `ACCESS_CODE` | 空 | 前端存取驗證碼（見上方「選配」） |
| `VITE_SYNC_SERVER_URL` | 空 | App 內「伺服器地址」輸入框的**預設值**。設為你的自架網址（如 `https://sync.yourdomain.com`）後，新裝置首次使用就預填你的伺服器（含 Google 代理換證目標），不再預設指向官方伺服器；留空 = 沿用官方預設 |

```bash
# 例：把前端預設伺服器指向自己的網域
docker build -f server/Dockerfile \
  --build-arg AD_FREE=1 \
  --build-arg VITE_SYNC_SERVER_URL=https://sync.yourdomain.com \
  -t jijun-selfhost .
# docker compose 則在 build.args（或 .env 的 VITE_SYNC_SERVER_URL）設定同名字串
```

### 資料持久化

SQLite DB 在 `SELF_HOST_DB_PATH`（Docker 預設 `/app/data/selfhost.db`，compose 已掛 `sync-data` volume）。
**備份你的資料 = 備份這個 DB 檔**：

```bash
docker compose exec sync-server cp /app/data/selfhost.db /tmp/selfhost.db
docker cp sync-server:/tmp/selfhost.db ./backup-$(date +%F).db
# 還原：關閉容器 → 放回 DB 檔 → 啟動
```

> 備份策略：server 端每使用者保留 `BACKUP_RETENTION_COUNT` 筆應用備份（前端「立即備份」產生的 JSON 快照）。
> 這兩者是不同層級的備份：**DB 檔 = 完整伺服器狀態**（含所有帳號），**應用備份 = 單一帳號的資料快照**（可在 app 內還原）。

---

## 前端 Build 參數：關閉廣告（AD_FREE）

廣告系統是 **100% build-time** 的：`package.json → adConfig → Vite define → __AD_*__` 編譯期常數。

```bash
# 純自架版 build：完全不載入任何廣告腳本（AdSense / GPT / AdMob）
AD_FREE=1 npm run build

# 一般版（含廣告）
npm run build
```

`AD_FREE=1` 的效果：
- `__AD_ENABLED__` 注入 `false` → `rewardService` 不載入 AdSense/GPT/AdMob 腳本、不初始化 AdMob SDK
- build 產物中 **AdSense client ID 等設定被 dead-code elimination 移除**（已實測驗證）
- 設定頁隱藏「觀看廣告以移除廣告 7 天」與底部 banner 容器

> 純自架部署**強烈建議**使用 `AD_FREE=1` build——你的使用者不該為你（或第三方）看廣告，
> 你也可以在 SELF_HOST_STATIC_DIR 提供的版本裡完全沒有廣告依賴。

### AdSense 設定（一般版）

若你部署**含廣告版本**（例如你想收 AdSense 收益），需要在 `package.json` 的 `adConfig` 填入**你的** AdSense 帳號：

```json
"adConfig": {
    "isTesting": false,
    "adsenseClientId": "ca-pub-你的AdSense編號",
    "adsenseAdSlot": "你的廣告單位",
    "gptRewardedAdUnitPath": "/你的GPT路徑/jijun",
    "admobBannerId": "你的AdMobBannerID",
    "admobRewardedId": "你的AdMobRewardedID",
    "webStoreUrl": "https://你的網站"
}
```

然後 `npm run build`。**純自架模式不需要填 AdSense 設定**（用 AD_FREE build 即可）。

---

## Google OAuth 設定（僅 OAuth Proxy 模式需要）

純自架模式**不需要**以下設定。若你要同時提供官方 Google Drive 同步（例如官方 web 版指到你的 server），才需要：

1. [Google Cloud Console](https://console.cloud.google.com/) 建立專案，啟用 **Google Drive API**
2. 建立 **OAuth 2.0 Client ID**（Web application 類型）
3. **Authorized JavaScript origins**：
    - `https://你的前端域名`
    - `http://localhost:3000`（開發用）
4. **Authorized redirect URIs**：
    - `https://你的前端域名`
    - `http://localhost:3000`
5. 把 `Client ID` / `Client Secret` 設進 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

前端「同步伺服器 URL」要指向你的 server（設定頁 → 伺服器設定），例如 `https://sync.你的域名`。

---

## 無 Docker：Node.js 直接運行

需要 **Node.js ≥ 22.5**（`node:sqlite`）。

```bash
# 前端
AD_FREE=1 npm run build

# server
cd server
export SELF_HOST_ADMIN_TOKEN=$(openssl rand -hex 32)
export DISABLE_GOOGLE_OAUTH=1
export PORT=8787
export SELF_HOST_DB_PATH=./data/jijun.db
export SELF_HOST_STATIC_DIR=../dist   # 同埠提供前端
node src/standalone.js
```

### systemd 服務範例（Linux）

```ini
# /etc/systemd/system/jijun-selfhost.service
[Unit]
Description=Jijun Easy Accounting Self-Host Sync Server
After=network.target

[Service]
WorkingDirectory=/opt/jijun/server
Environment=SELF_HOST_ADMIN_TOKEN=在此填入隨機token
Environment=DISABLE_GOOGLE_OAUTH=1
Environment=PORT=8787
Environment=SELF_HOST_DB_PATH=/opt/jijun/data/jijun.db
Environment=SELF_HOST_STATIC_DIR=/opt/jijun/dist
ExecStart=/usr/bin/node src/standalone.js
Restart=on-failure
User=jijun

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now jijun-selfhost
sudo systemctl status jijun-selfhost
```

### HTTPS 反向代理（Caddy 範例）

```
sync.yourdomain.com {
    reverse_proxy localhost:8787
}
```

Nginx 重點：`proxy_set_header X-Forwarded-Proto https;`（server 會用它決定 URL 協議）。
`ALLOWED_ORIGINS` **務必設為你的前端域名（而非 `*`）**，例如：

```bash
ALLOWED_ORIGINS=https://jijun.yourdomain.com
```

> 2026-10 紅隊修復後 CORS 行為：白名單為 `*` 時一律回 `Access-Control-Allow-Origin: *`
> （不再反射任意 Origin）；設為明確域名後，只有白名單內的 origin 能拿到 CORS 標頭，
> 其他網站的 JS 一律被瀏覽器擋掉。同網域部署（前端與 API 同一 origin）時此欄位影響較小，
> 但只要可能有多網域，就應該明確列白名單。

---

## API 端點

| Method | Path | 說明 |
| ------ | ---- | ---- |
| `POST` | `/api/selfhost/register` | 註冊帳號（body: `{username, pin, deviceId?}`）→ `201 {token, username}`；帳號已存在時等同登入（`200`）。**公開註冊關閉時回 `403`**（`SELF_HOST_ALLOW_REGISTER=0`，預設） |
| `POST` | `/api/selfhost/login` | 登入（body: `{username, pin}`）→ `{token, username}` |
| `GET` | `/api/selfhost/me` | 目前帳號 + 裝置列表 |
| `POST` | `/api/selfhost/devices/register` | 註冊裝置（body: `{deviceId}`） |
| `POST` | `/api/selfhost/push` | 推送變更（body: `{deviceId, changes[]}`，≤5000 筆/次） |
| `GET` | `/api/selfhost/pull?since=<ts>&deviceId=<id>` | 拉取其他裝置變更 |
| `POST` | `/api/selfhost/backup` | 存備份（body: `{fileName, content, deviceId?}`） |
| `GET` | `/api/selfhost/backups` | 備份列表 |
| `GET` | `/api/selfhost/backups/:id` | 取備份內容 |
| `DELETE` | `/api/selfhost/backups/:id` | 刪備份 |
| `GET` | `/api/health` | 健康檢查（含 `selfHosted`、`registerEnabled` 欄位） |

### Admin（帳號管理，需 admin token）

| Method | Path | 說明 |
| ------ | ---- | ---- |
| `POST` | `/api/selfhost/admin/users` | 建立帳號（body: `{username, pin}`）→ `201 {id, username, pin}`（**pin 僅回傳一次**） |
| `GET` | `/api/selfhost/admin/users` | 帳號列表（含 `isAdmin`、`deviceCount`、`registerEnabled`） |
| `POST` | `/api/selfhost/admin/users/:username/reset-pin` | 重置 PIN（body: `{pin}`） |
| `DELETE` | `/api/selfhost/admin/users/:username` | 刪除帳號（含裝置/同步 log/備份；bootstrap admin 不可刪） |
| `PUT` | `/api/selfhost/admin/settings/register` | 公開註冊開關（body: `{enabled}`，DB 覆寫 env，重啟仍生效） |

非 admin 存取 → `403`。admin token = bootstrap admin（`SELF_HOST_ADMIN_TOKEN`）登入取得的 token。

### Shared Ledgers（跨帳號共用帳本）

| Method | Path | 說明 |
| ------ | ---- | ---- |
| `POST` | `/api/selfhost/shared` | 建立共用帳本（body: `{ledgerUuid, name, content}`）→ `201 {uuid}`（建立者自動為 owner） |
| `GET` | `/api/selfhost/shared` | 列出我的共用帳本（成員或 owner） |
| `GET` | `/api/selfhost/shared/:uuid` | 讀取 content（成員） |
| `PUT` | `/api/selfhost/shared/:uuid` | 覆寫 content（成員；完整比對式 log，同 Google Drive 版語意） |
| `DELETE` | `/api/selfhost/shared/:uuid` | 刪除（owner） |
| `GET` | `/api/selfhost/shared/lookup?code=<uuid 或前 8 字>` | 解析共用代碼 → `{found, uuid, name}` |
| `GET` | `/api/selfhost/shared/:uuid/members` | 成員列表（`{members, isOwner}`） |
| `POST` | `/api/selfhost/shared/:uuid/members` | 邀請帳號加入（owner；body: `{username}`） |
| `DELETE` | `/api/selfhost/shared/:uuid/members/:username` | 移除成員（owner） |

### 管理 CLI（免開 web）

```bash
# 列出帳號
docker compose exec sync-server node src/admin-cli.js list

# 手動建立帳號（註冊關閉時的標準做法）
docker compose exec sync-server node src/admin-cli.js create --username wife --pin wife-secret-1

# 重置 PIN / 刪帳號 / 註冊開關
docker compose exec sync-server node src/admin-cli.js reset-pin --username wife --pin new-secret
docker compose exec sync-server node src/admin-cli.js delete --username wife
docker compose exec sync-server node src/admin-cli.js set-register --disable
```

（`--pin-file <path>` 可改從檔案讀 PIN，避免進 shell history。）

認證：`Authorization: Bearer *** 為持久 token（SHA-256 hash 存 DB），**沒有過期機制**——洩漏時可重設 DB 或刪 user 使所有 token 失效。

### 帳號規則

- username：2–32 字元，僅限英數字 / `_` / `-`
- PIN：4–64 字元
- 裝置歸屬：裝置首次 push 時自動歸屬當前帳號；已屬於**別**的帳號的裝置會回 `403`（防跨帳號注入）

---

## 家人共用：各自帳號 + 共用單一帳本

**設計取態**：不假設家人要共用同一帳號。每個家人有**各自帳號**（各自記帳隱私、各自裝置同步），需要共用的帳本（例如「家庭支出」）用**共用帳本**機制跨帳號共享：

1. **管理員建帳號**：公開註冊預設關閉。由管理員在 web「設定 → 雲端備份&同步 → 自架同步 → 管理員：帳號管理」或 CLI（`admin-cli.js create`）為每位家人建帳號、設定 PIN。
2. **各自登入**：每位家人用自己的帳號登入（各裝置皆然）。
3. **共用帳本**：帳本頁 → 某帳本 →「共用帳本」→ 輸入對方**帳號名稱**邀請（self-host 模式不需 email）→ 產生**共用代碼**（= 帳本 uuid；可 QR code / 前 8 碼）。
4. **加入**：家人在帳本頁「加入共用帳本」輸入代碼 → 本機載入該帳本 → 之後該帳本的變更會跨帳號自動同步（完整比對式，與 Google Drive 版共用帳本相同語意）。
5. **隱私分離**：只有被共用的帳本跨帳號流通；其他帳本、紀錄、帳戶完全隔離在各自帳號。

> 共用帳本目前採「完整比對式 log」（與 Google Drive 版一致）：成員每次推送時攜帶該帳本的完整 change log 做合併。成員多、帳本大時建議定期「取消共用→重新共用」做 log 壓縮（同 Drive 版限制）。

---

## 前端使用者操作（app 內）

1. 設定 → **雲端備份&同步**
2. 「伺服器設定」填入你的 server URL（例如 `https://sync.yourdomain.com`）→ 儲存
3. 「自架同步（Self-Host）」區塊：
   - 「測試伺服器連線」確認 server 已啟用自架同步（`health.selfHosted=true`）
   - 首次：輸入帳號 / PIN → **註冊新帳號**
   - 其他裝置：輸入同一帳號 / PIN → **登入**
4. 登入後即可使用「立即備份 / 還原備份 / 自動備份 / 自動同步 / 立即同步」
5. 同一帳號的所有裝置會自動互相同步變更（與 Google Drive 版體驗一致）

> 注意：self-host 帳號與 Google 帳號是**兩套獨立系統**，資料不會互通。
> 登入 self-host 會登出 Google（同一裝置同一時間只走一條通道）。

---

## 故障排除

| 症狀 | 原因 / 解法 |
| ---- | ---------- |
| `health.selfHosted` 是 `false` | 未設 `SELF_HOST_ADMIN_TOKEN`（重啟後才生效） |
| 啟動報 `Missing required environment variables` | 純自架模式需要 `SELF_HOST_ADMIN_TOKEN` + `DISABLE_GOOGLE_OAUTH=1` |
| 前端「無法連接到伺服器」 | 檢查 URL / 埠 / HTTPS 反代 / `ALLOWED_ORIGINS` |
| 註冊回 `403 Registration is disabled` | 公開註冊已關閉（預設）。由管理員建帳號（web 管理員面板 / `admin-cli.js create`），或 `set-register --enable` / `SELF_HOST_ALLOW_REGISTER=1` 開啟 |
| 登入回 401 | PIN 錯誤；或 DB 被重設過（token 失效，重新登入即可） |
| push 回 403 `Device belongs to another account` | 該 deviceId 已註冊在別的帳號（換裝置 ID 或檢查是否用錯帳號） |
| push 回 400 `Too many changes` | 單批 >5000 筆；app 端會自動取最新批次，重試即可 |
| 頁面打不開、API 正常 | `SELF_HOST_STATIC_DIR` 路徑錯誤或 image 未含前端（自 build 時確認 stage 1 build 成功） |
| 備份還原後資料重複 | 還原後 app 會自動 `markAllRemoteChangesAsPulled`；若異常請重新登入該帳號 |
| 共用帳本加入失敗「找不到該共用帳本」 | 代碼錯誤、未受邀、或該帳本已被 owner 刪除 |

## 安全建議

1. **HTTPS**：生產環境務必用 HTTPS（PIN 與 token 走明文 HTTP 會被截獲）
2. **強 token**：`SELF_HOST_ADMIN_TOKEN` 用 `openssl rand -hex 32` 產生
3. **公開註冊預設已關閉**：需要時才開（`SELF_HOST_ALLOW_REGISTER=1` 或 admin runtime 切換）；對外的話仍建議加 reverse proxy 限流（目前 API 無 rate limit）
4. **定期備份 DB 檔**（見上方「資料持久化」）
5. 更新程序：`docker compose up -d --build`（重新 build 前端 + server）；DB schema 升級時 server 會自動 `CREATE TABLE IF NOT EXISTS`（目前無破壞性 migration）
6. **ACCESS_CODE 是 UX 門檻非安全機制**：驗證碼在 bundle 內，擋不住懂技術的人。真正的外部存取防護用 reverse proxy（IP 白名單 / Basic Auth / VPN）

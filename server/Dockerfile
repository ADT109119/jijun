# Easy Accounting Sync Server — Docker（前後端一體）
#
# 多階段 build：
#   stage 1 (frontend)：把 web 前端 build 進 image（預設 AD_FREE=1 無廣告、
#                       ACCESS_CODE 可 build-arg 注入前端驗證碼）
#   stage 2 (server)  ：node:22-alpine 跑同步 API + 提供前端靜態檔（同 port）
#
# node:sqlite 需要 Node.js >= 22.5（self-host 同步用 SQLite 為預設 DB）
#
# 注意：build context 是 repo 根目錄（從 repo 根目錄執行：
#   docker build -t jijun-selfhost .        # AD_FREE=1
#   docker build --build-arg ACCESS_CODE=*** -t jijun-selfhost .
# 若只想要 API-only（不含前端）的 image，可自建單階段 Dockerfile 或直接掛 volume。

# ──────────────────────────── Stage 1: 前端 build ────────────────────────────
FROM node:22-alpine AS frontend

ARG AD_FREE=1
ARG ACCESS_CODE=
# 自架部署的前端預設同步伺服器位址（build 期注入 import.meta.env.VITE_SYNC_SERVER_URL）。
# 設定後，App「伺服器地址」預設值就是你的自架網址（含 Google 代理換證目標），
# 不再指向官方伺服器。留空 = 沿用官方預設（一般版行為不變）。
ARG VITE_SYNC_SERVER_URL=
# 搜尋引擎索引控制（預設 1 = 注入 noindex, nofollow 防止自架站被爬取）
ARG NO_INDEX=1
ENV AD_FREE=${AD_FREE}
ENV ACCESS_CODE=${ACCESS_CODE}
ENV VITE_SYNC_SERVER_URL=${VITE_SYNC_SERVER_URL}
ENV NO_INDEX=${NO_INDEX}

WORKDIR /build

# 前端依賴（用 lockfile 確保重現性）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 前端原始碼 + build 設定（postcss/tailwind config 必須一起 COPY，
# 否則容器內 build 時 Tailwind 不執行、utility class 全缺（CSS 只剩自訂樣式））
COPY index.html vite.config.js ./
COPY postcss.config.js tailwind.config.js ./
COPY src/ ./src/
COPY public/ ./public/

# build 前端（AD_FREE / ACCESS_CODE 由 build-arg 注入，100% 編譯期）
RUN npm run build

# ──────────────────────────── Stage 2: 同步伺服器 ────────────────────────────
FROM node:22-alpine AS server

# su-exec：entrypoint 降權用（紅隊報告 M-2）
RUN apk add --no-cache su-exec

WORKDIR /app

# 前端 build 產物（/app/static；standalone.js 的 SELF_HOST_STATIC_DIR 指到此處）
COPY --from=frontend --chown=root:root /build/dist /app/static
ENV SELF_HOST_STATIC_DIR=/app/static

# server 原始碼（無 npm 依賴：node:sqlite 為 Node >= 22.13.0 內建模組）
COPY server/package.json ./package.json
COPY server/src/ ./src/

# Data volume (SQLite DB 等)
VOLUME /app/data
ENV SELF_HOST_DB_PATH=/app/data/selfhost.db
ENV NO_INDEX=1
ENV DISABLE_GOOGLE_OAUTH=1

# Expose default port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/health || exit 1

# 降權執行（紅隊報告 M-2）：
# entrypoint 進程若為 root（compose 預設），先修一次 data 目錄擁有權
# （相容舊版 root 容器留下的 volume），再 su-exec 降為 node（uid 1000）
# 執行——最終 server 進程**非 root**。若你在 compose 指定 user:，
# entrypoint 直接 exec（跳過 chown）。
# 鏡像內 /app 檔案全 root-owned 唯讀 → 即便 Node 層被 RCE，
# 攻擊者無 root、無法改寫程式碼或系統檔，僅能觸及 /app/data（自己帳號權限內）。
COPY server/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

# Run standalone server（API + 前端靜態檔，同 port 8080）
CMD ["node", "src/standalone.js"]

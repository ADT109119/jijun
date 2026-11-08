#!/bin/sh
# Easy Accounting Sync Server — 降權 entrypoint（紅隊報告 M-2）
#
# 鏡像預設以 node (uid 1000) 執行。但舊版容器以 root 跑過，
# named volume（/app/data）裡的 selfhost.db 可能仍是 root-owned，
# 直接以 node 啟動會寫不進去。
#
# 策略：容器以 root 進入時（預設 compose 行為），先 chown 一次
# data 目錄，再經 su-exec 降為 node 執行 —— 全程最終進程非 root。
# 若使用者在 compose 已指定 user:（非 root），直接 exec 不做 chown。

set -e

DATA_DIR="${SELF_HOST_DB_PATH:-/app/data/selfhost.db}"
DATA_DIR=$(dirname "$DATA_DIR")

if [ "$(id -u)" = "0" ]; then
    mkdir -p "$DATA_DIR"
    chown -R node:node "$DATA_DIR"
    chmod 700 "$DATA_DIR"
    exec su-exec node "$@"
fi

exec "$@"

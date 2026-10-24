#!/usr/bin/env python3
"""紅隊修復線上驗證：對重建後的容器逐項驗證 8 項修復
注意：不輸出任何 secrets；token 只在記憶體中使用。"""
import json, re, os, urllib.request, urllib.error, time

BASE = "http://localhost:8080"
env = open(os.path.expanduser("~/projects/jijun/server/.env")).read()
ADMIN_TOKEN = re.search(r'^SELF_HOST_ADMIN_TOKEN=(.+)$', env, re.M).group(1).strip()

results = []

def req(method, path, body=None, token=None, headers=None, origin=None):
    url = BASE + path
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = f"Bearer {token}"
    if origin: h["Origin"] = origin
    if headers: h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    def norm(hd):
        # Node Headers 序列化為小寫 key；統一小寫比對
        return {k.lower(): v for k, v in dict(hd).items()}
    try:
        resp = urllib.request.urlopen(r, timeout=15)
        return resp.status, norm(resp.headers), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, norm(e.headers), e.read().decode("utf-8", "replace")

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail if not ok else ""))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  [{detail[:120]}]"))

# ══ 基礎 ══
s, h, b = req("GET", "/api/health")
check("容器健康 /api/health 200", s == 200 and '"ok"' in b, b[:100])

# ══ M-3 安全標頭 ══
check("M3 CSP 存在且含 frame-ancestors none", "none" in h.get("content-security-policy", "") and "frame-ancestors" in h.get("content-security-policy", ""), str(h.get("Content-Security-Policy"))[:80])
check("M3 X-Frame-Options DENY", h.get("x-frame-options") == "DENY", str(h.get("x-frame-options")))
check("M3 X-Content-Type-Options nosniff", h.get("x-content-type-options") == "nosniff")
check("M3 Referrer-Policy", "strict-origin" in h.get("referrer-policy", ""), str(h.get("referrer-policy")))
check("M3 Permissions-Policy", "geolocation=()" in h.get("permissions-policy", ""))
check("M3 COOP", h.get("cross-origin-opener-policy") == "same-origin")
# 靜態頁標頭
s, h2, _ = req("GET", "/")
check("M3 靜態 index 帶 CSP", "frame-ancestors" in h2.get("content-security-policy", ""))
check("M3 靜態 index no-cache", h2.get("cache-control") == "no-cache", str(h2.get("cache-control")))

# ══ L-2 TRACE 405 ══
s, h3, b = req("TRACE", "/api/health")
check("L2 TRACE → 405（原 500）", s == 405, f"status={s}")
check("L2 405 帶 Allow 標頭", "allow" in h3 and "GET" in h3.get("allow", ""), str(h3.get("allow")))
s, _, _ = req("PATCH", "/api/selfhost/login")
check("L2 PATCH → 405", s == 405, f"status={s}")

# ══ H-1 CORS ══
s, h4, _ = req("GET", "/api/health", origin="https://evil.example.com")
acao = h4.get("access-control-allow-origin")
check("H1 ALLOWED_ORIGINS=* 時回字面 *（不反射 evil）", acao == "*", f"acao={acao}")

# ══ H-2 舊 DB 相容 + scrypt 升級（線上真實鏈：admin 的 pin_hash 是舊版 sha256）══
s, _, b = req("POST", "/api/selfhost/login", {"username": "admin", "pin": ADMIN_TOKEN})
admin_token = json.loads(b).get("token") if s == 200 else None
check("H2 admin 舊 sha256 hash 登入成功（相容路徑+自動升級）", s == 200 and admin_token, f"status={s}")
at = admin_token
s, _, b = req("POST", "/api/selfhost/login", {"username": "admin", "pin": ADMIN_TOKEN})
check("H2 admin 二次登入（升級後 scrypt 路徑）成功", s == 200, f"status={s}")

# 錯誤 PIN ×12 → 429（用不存在的帳號名，避免碰真實帳號）
last = None
for i in range(12):
    last = req("POST", "/api/selfhost/login", {"username": "rl-probe-nonexistent", "pin": "bad-pin-xx"})
check("H2 login 12 連錯 → 429", last[0] == 429, f"status={last[0]}")
check("H2 429 帶 Retry-After", int(last[1].get("retry-after", "0") or 0) > 0, str(last[1].get("retry-after")))
s, _, b = req("POST", "/api/selfhost/login", {"username": "admin", "pin": ADMIN_TOKEN})
check("H2 限速按帳號隔離（admin 不受 rl-probe 牽連）", s == 200, f"status={s}")

# ══ M-1 lookup ══
import uuid as uuidmod
if not at:
    print("!! admin token 取得失敗，跳過需要 auth 的驗證")
    raise SystemExit(2)
# 非成員身分：用 admin 建一個臨時 probe 帳號（註冊開關臨時開，測完關掉+刪帳號）
s, _, _ = req("PUT", "/api/selfhost/admin/settings/register", {"enabled": True}, token=at)
s, _, b = req("POST", "/api/selfhost/register", {"username": "m1probe", "pin": "m1-probe-pin"})
fam_token = json.loads(b).get("token") if s in (200, 201) else None
check("M1 建立臨時 probe 帳號", bool(fam_token), f"status={s}")
LUUID = str(uuidmod.uuid4())
s, _, _ = req("POST", "/api/selfhost/shared", {"ledgerUuid": LUUID, "name": "紅隊驗證帳本", "content": {"deviceId": "dev-r", "timestamp": int(time.time()*1000), "changes": []}}, token=at)
check("M1 admin 建立測試共用帳本", s == 201, f"status={s}")
s, _, b = req("GET", f"/api/selfhost/shared/lookup?code={LUUID[:8]}", token=fam_token)
j = json.loads(b) if s == 200 else {}
check("M1 非成員（family1）lookup → found 但無 name/uuid", s == 200 and j.get("found") is True and "name" not in j and "uuid" not in j, b[:100])
s, _, b = req("GET", f"/api/selfhost/shared/lookup?code={LUUID[:8]}", token=at)
j = json.loads(b) if s == 200 else {}
check("M1 成員（owner）lookup → 附 uuid+name", j.get("uuid") == LUUID and j.get("name") == "紅隊驗證帳本", b[:100])

# ══ L-1 註冊統一訊息 ══
# 註冊關閉中 → 先開
s, _, _ = req("PUT", "/api/selfhost/admin/settings/register", {"enabled": True}, token=at)
s, _, b = req("POST", "/api/selfhost/register", {"username": "admin", "pin": "definitely-wrong-pin"})
j = json.loads(b) if b else {}
check("L1 已存在帳號+錯 PIN 註冊 → 401 且訊息與 login 相同", s == 401 and j.get("error") == "Invalid username or PIN", f"status={s} {j}")
# 恢復註冊關閉
req("PUT", "/api/selfhost/admin/settings/register", {"enabled": False}, token=at)

# ══ 容器降權 ══
import subprocess
# M2 判準：server 主進程（真正跑 Node 的）非 root。
# docker exec 通道的預設 user 是鏡像 USER（root，供 entrypoint chown 用），
# 與 server 進程權限無關——能 docker exec 代表已有 host 權限，非本威脅模型。
r2 = subprocess.run(["docker", "exec", "easy-accounting-sync", "ps", "-o", "user,args"], capture_output=True, text=True, timeout=30)
node_line = [l for l in r2.stdout.splitlines() if "node" in l and "standalone" in l]
check("M2 node standalone 進程以 node 執行", node_line and "node" in node_line[0].split()[0].lower(), str(node_line)[:120])

# ══ 清理 ══
if at:
    req("DELETE", f"/api/selfhost/shared/{LUUID}", token=at)
    req("DELETE", "/api/selfhost/admin/users/m1probe", token=at)
    req("PUT", "/api/selfhost/admin/settings/register", {"enabled": False}, token=at)
print()
fails = [x for x in results if not x[1]]
print(f"===== 線上驗證 {len(results)-len(fails)}/{len(results)} PASS =====")
if fails:
    for n, _, d in fails:
        print("FAIL:", n, d)
    raise SystemExit(1)

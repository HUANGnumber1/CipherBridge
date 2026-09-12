#!/usr/bin/env bash
# =============================================================================
# check_apis.sh — CipherBridge 三服务健康检查脚本
# 检测范围：FHE-API(:3000) / 区块链RPC(:8545) / 前端(:5173)，共 13 项
# 用法：bash /root/check_apis.sh          （全部检测）
#       bash /root/check_apis.sh 2>&1 | tail -n 20   （只看汇总）
# 退出码：全部通过 0；任一失败 1
# =============================================================================

set -u

HOST="${HOST:-127.0.0.1}"
PK="${PK:-0xAaBbCcDdEeFf00112233445566778899aAbBcCdD}"
DEPLOY_ACCOUNT="${DEPLOY_ACCOUNT:-}"

PASS=0
FAIL=0
fail_list=""

log()   { printf '%-44s [%s]\n' "$1" "$2"; }
ok()    { log "$1" "PASS"; PASS=$((PASS+1)); }
bad()   { log "$1" "FAIL"; FAIL=$((FAIL+1)); fail_list="$fail_list\n  - $1"; }

json_post() { # url json
  curl -s -m 120 -X POST "$1" -H 'Content-Type: application/json' -d "$2"
}

# ---------- 1. FHE-API ----------
BASE="http://${HOST}:3000"

# 1.1 端口监听
if ss -lntp 2>/dev/null | grep -q ':3000 '; then
  ok "[1.1] FHE-API 端口3000 监听"
else
  bad "[1.1] FHE-API 端口3000 监听（服务未启动？）"
fi

# 1.2 generate_keys
gk=$(json_post "$BASE/generate_keys" "{\"public_key\":\"$PK\"}" 2>/dev/null)
if echo "$gk" | grep -q '"fhe_public_key"' && echo "$gk" | grep -q '"client_key":"[^"]'; then
  ok "[1.2] generate_keys"
else
  bad "[1.2] generate_keys（${gk:0:80}）"
fi

# 1.3 get_public_key
pk=$(json_post "$BASE/get_public_key" "{\"public_key\":\"$PK\"}" 2>/dev/null)
if echo "$pk" | grep -q '"fhe_public_key":"[^"]'; then
  ok "[1.3] get_public_key"
else
  bad "[1.3] get_public_key（${pk:0:80}）"
fi

# 1.4 encrypt x 3
enc_values=""
enc_ok=1
for v in 12 30 4; do
  r=$(json_post "$BASE/encrypt" "{\"public_key\":\"$PK\",\"data_type\":\"monthly_income\",\"value\":$v}" 2>/dev/null)
  ev=$(echo "$r" | sed -n 's/.*"encrypted_value":"\([^"]*\)".*/\1/p')
  if [ -z "$ev" ]; then enc_ok=0; break; fi
  [ -n "$enc_values" ] && enc_values="$enc_values,"
  enc_values="$enc_values\"$ev\""
done
if [ "$enc_ok" -eq 1 ]; then
  ok "[1.4] encrypt (12/30/4)"
else
  bad "[1.4] encrypt"
fi

# 1.5 compute
sum=$(json_post "$BASE/compute" "{\"public_key\":\"$PK\",\"task_id\":\"healthcheck\",\"data_type\":\"monthly_income\",\"encrypted_values\":[$enc_values]}" 2>/dev/null)
cres=$(echo "$sum" | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')
if [ -n "$cres" ]; then
  ok "[1.5] compute"
else
  bad "[1.5] compute（${sum:0:80}）"
fi

# 1.6 decrypt
dec=$(json_post "$BASE/decrypt" "{\"public_key\":\"$PK\",\"data_type\":\"monthly_income\",\"encrypted_value\":\"$cres\"}" 2>/dev/null)
val=$(echo "$dec" | sed -n 's/.*"value":\([0-9]*\).*/\1/p')
if [ -n "$val" ]; then
  ok "[1.6] decrypt (value=$val)"
else
  bad "[1.6] decrypt（${dec:0:80}）"
fi

# 1.7 端到端校验：12+30+4 应等于 46
if [ "$val" = "46" ]; then
  ok "[1.7] 端到端 12+30+4=46"
else
  bad "[1.7] 端到端校验（期望46 实得${val:-无}）"
fi

# ---------- 2. 区块链 RPC ----------
RPC="http://${HOST}:8545"

cid=$(json_post "$RPC" '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>/dev/null)
if echo "$cid" | grep -q '"0x4ee8"'; then
  ok "[2.1] eth_chainId == 20200"
else
  bad "[2.1] eth_chainId（${cid:0:80}）"
fi

blk=$(json_post "$RPC" '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":2}' 2>/dev/null)
if echo "$blk" | grep -q '"0x'; then
  ok "[2.2] eth_blockNumber"
else
  bad "[2.2] eth_blockNumber（${blk:0:80}）"
fi

if [ -n "$DEPLOY_ACCOUNT" ]; then
  bal=$(json_post "$RPC" "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$DEPLOY_ACCOUNT\",\"latest\"],\"id\":3}" 2>/dev/null)
  if echo "$bal" | grep -q '"result":"0x[1-9a-fA-F]'; then
    ok "[2.3] 部署账户余额非0"
  else
    bad "[2.3] 部署账户余额（${bal:0:80}）"
  fi
else
  log "[2.3] 部署账户余额" "SKIP（未设 DEPLOY_ACCOUNT）"
fi

nv=$(json_post "$RPC" '{"jsonrpc":"2.0","method":"net_version","params":[],"id":4}' 2>/dev/null)
if echo "$nv" | grep -q '"20200"'; then
  ok "[2.4] net_version == 20200"
else
  bad "[2.4] net_version（${nv:0:80}）"
fi

# ---------- 3. 前端 ----------
WEB="http://${HOST}:5173"

code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$WEB/" 2>/dev/null)
if [ "$code" = "200" ]; then
  ok "[3.1] 前端 5173 返回200"
else
  bad "[3.1] 前端 5173（HTTP ${code}）"
fi

pcid=$(json_post "$WEB/api" '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>/dev/null)
if echo "$pcid" | grep -q '"0x4ee8"'; then
  ok "[3.2] /api 代理链"
else
  bad "[3.2] /api 代理链（${pcid:0:80}）"
fi

pgk=$(json_post "$WEB/service/generate_keys" "{\"public_key\":\"$PK\"}" 2>/dev/null)
if echo "$pgk" | grep -q '"fhe_public_key"'; then
  ok "[3.3] /service 代理FHE-API"
else
  bad "[3.3] /service 代理FHE-API（${pgk:0:80}）"
fi

# ---------- 汇总 ----------
echo
if [ "$FAIL" -eq 0 ]; then
  echo "==== 结果: ${PASS}/$((PASS+FAIL)) 通过 ===="
  exit 0
else
  echo "==== 结果: ${PASS}/$((PASS+FAIL)) 通过，存在 $FAIL 项失败 ===="
  echo "失败项:$fail_list"
  exit 1
fi


#!/usr/bin/env bash
# ============================================================================
# start_services.sh — 起「链 → 部署 → 回填地址 → FHE-API → 前端」
# 依据 resume_zhixing.sh，日志 /tmp/start_services.log
# ============================================================================
exec > /tmp/start_services.log 2>&1
set -uo pipefail
ROOT=/root/Bisai
RPC=http://127.0.0.1:8545
. "$HOME/.cargo/env" 2>/dev/null || true
export PATH="$HOME/.cargo/bin:$PATH"
say(){ echo; echo "===== $* ====="; date '+%T'; }
die(){ echo "[FATAL] $*"; touch /tmp/start_services.fail; exit 1; }

say "0. 前置检查"
[ -d "$ROOT/FHE-Protocol" ] || die "缺 FHE-Protocol"
[ -d "$ROOT/FHE-API" ]      || die "缺 FHE-API"
[ -d "$ROOT/FHE-Frontend" ] || die "缺 FHE-Frontend"

say "1. 清理旧 tmux 会话"
for s in chain api web; do tmux kill-session -t "$s" 2>/dev/null || true; done

say "2. 启动 hardhat node (:8545)"
tmux new -d -s chain "cd '$ROOT/FHE-Protocol' && npx hardhat node > /tmp/chain.log 2>&1"
ok=""
for i in $(seq 1 60); do
  curl -s -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' "$RPC" >/dev/null 2>&1 && { ok=1; break; }
  sleep 2
done
[ -n "$ok" ] || die "链未就绪，见 /tmp/chain.log"
echo "链已就绪"

# 2.5 给部署账户充值（修复：hardhat node 只给默认助记词账户发币，
#     hardhat.config.js 的 localhost.accounts 私钥对应账户余额为 0，导致部署报 insufficient funds）
DEPLOYER=$(cd "$ROOT/FHE-Protocol" && node -e "const{Wallet}=require('ethers');console.log(new Wallet('0x264f1815624a86a569e96f500bb1c1c5f65d580881fd6d6e675532640d86c248').address)" 2>/dev/null)
[ -n "$DEPLOYER" ] || die "无法推导部署账户地址"
echo "部署账户: $DEPLOYER"
curl -s -X POST -H 'Content-Type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"method\":\"hardhat_setBalance\",\"params\":[\"$DEPLOYER\",\"0x21e19e0c9bab2400000\"],\"id\":1}" "$RPC" >/dev/null
BAL=$(curl -s -X POST -H 'Content-Type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$DEPLOYER\",\"latest\"],\"id\":1}" "$RPC")
echo "部署账户余额: $BAL"

say "3. 部署合约"
(cd "$ROOT/FHE-Protocol" && npx hardhat run scripts/deploy.js --network localhost) || die "部署失败"
[ -s "$ROOT/FHE-Protocol/deployments.json" ] || die "deployments.json 为空"
cat "$ROOT/FHE-Protocol/deployments.json"

say "4. 回填 FHE-Frontend/src/config/contracts.ts"
node /root/Bisai/tools/patch-addr.js || die "回填地址失败"

say "5. 启动 FHE-API (:3000)"
tmux new -d -s api "cd '$ROOT/FHE-API' && cargo run --release > /tmp/fhe_api.log 2>&1"
ok=""
for i in $(seq 1 300); do
  if curl -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then ok=1; break; fi
  tmux has-session -t api 2>/dev/null || break
  sleep 2
done
[ -n "$ok" ] || die "FHE-API 未就绪，见 /tmp/fhe_api.log"
echo "FHE-API 已就绪"

say "6. 启动前端 (:5173)"
tmux new -d -s web "cd '$ROOT/FHE-Frontend' && npm run dev -- --host 0.0.0.0 > /tmp/web.log 2>&1"
ok=""
for i in $(seq 1 45); do
  curl -s http://127.0.0.1:5173/ -o /dev/null 2>/dev/null && { ok=1; break; }
  sleep 2
done
[ -n "$ok" ] || die "前端未就绪，见 /tmp/web.log"
echo "前端已就绪"

say "全部启动完成"
tmux ls 2>&1
touch /tmp/start_services.done

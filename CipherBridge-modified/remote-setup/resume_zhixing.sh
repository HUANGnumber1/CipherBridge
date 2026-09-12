#!/usr/bin/env bash
# ============================================================================
# resume_zhixing.sh — 智星云(CipherBridge)断点续跑脚本
# 适用场景：实例曾关机/重启(数据盘保留)，代码/编译缓存/node_modules 都还在，
#           只需重建「内存链 + 部署 + 前端地址回填 + 服务」。
# 用法：
#   chmod +x resume_zhixing.sh
#   bash resume_zhixing.sh
# 依赖：已按 ZHIXINGYUN_GUIDE.md 第3步装好 node/rust；第6步后本目录结构完整。
# ============================================================================
set -uo pipefail

ROOT="${1:-/root/Bisai}"
FHE_PROTOCOL="$ROOT/FHE-Protocol"
FHE_API="$ROOT/FHE-API"
FHE_WEB="$ROOT/FHE-Frontend"
RPC="http://127.0.0.1:8545"

say(){ echo; echo "==================== $* ===================="; }
die(){ echo; echo "[FATAL] $*"; echo "处理建议：按提示修复后重跑：bash /root/resume_zhixing.sh（服务步骤可重复执行）"; exit 1; }

# --- 0. 前置检查 -------------------------------------------------------------
say "0. 前置检查"
[ -d "$FHE_PROTOCOL" ] || die "找不到 $FHE_PROTOCOL（代码未上传或数据盘被重置）"
[ -d "$FHE_API" ]     || die "找不到 $FHE_API"
[ -d "$FHE_WEB" ]     || die "找不到 $FHE_WEB"
[ -d "$FHE_API/target" ] && echo "✓ cargo 缓存存在（FHE-API 无需重编译）" \
                         || echo "⚠ 无 cargo 缓存：本次 FHE-API 会触发完整编译，请耐心等待"
[ -d "$FHE_WEB/node_modules" ] && echo "✓ 前端依赖已装" \
                                || { echo "→ 正在安装前端依赖..."; (cd "$FHE_WEB" && npm install --registry=https://registry.npmmirror.com) || die "npm install 失败"; }

# --- 1. 清掉旧 tmux 会话，确保端口干净 ----------------------------------------
say "1. 清理旧的 tmux 会话"
for s in chain api web; do tmux kill-session -t "$s" 2>/dev/null || true; done

# --- 2. 启动 hardhat node（内存链）并等待 8545 就绪 ----------------------------
say "2. 启动本地链 hardhat node (:8545)"
tmux new -s chain -d "cd '$FHE_PROTOCOL' && npx hardhat node" || die "无法创建 chain 会话"
ok=""
for i in $(seq 1 60); do
  if curl -s -X POST -H 'Content-Type: application/json' \
       --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
       "$RPC" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || die "链未就绪，请 tmux attach -t chain 看日志"
echo "✓ 链已就绪"

# --- 3. 重新部署 5 个合约 ------------------------------------------------------
say "3. 重新部署合约 (deploy.js → deployments.json)"
(cd "$FHE_PROTOCOL" && npx hardhat run scripts/deploy.js --network localhost) || die "部署失败"
[ -s "$FHE_PROTOCOL/deployments.json" ] || die "deployments.json 为空"
echo "✓ 新合约地址如下："; cat "$FHE_PROTOCOL/deployments.json"

# --- 4. 回填前端 contracts.ts -------------------------------------------------
say "4. 用新地址回填 FHE-Frontend/src/config/contracts.ts"
cat > /tmp/patch-addr.js <<'EOF'
const fs = require('fs');
const dp = JSON.parse(fs.readFileSync('/root/Bisai/FHE-Protocol/deployments.json', 'utf8'));
const map = {
  AccessControl: dp.accessControl,
  BankRegistry:  dp.bankRegistry,
  DataStorage:   dp.dataStorage,
  TaskManagement:dp.taskManagement,
  UserRegistry:  dp.userRegistry,
};
const file = '/root/Bisai/FHE-Frontend/src/config/contracts.ts';
let s = fs.readFileSync(file, 'utf8');
for (const [k, addr] of Object.entries(map)) {
  const re = new RegExp('(' + k + ":\\s*')(0x[0-9a-fA-F]{40})(')");
  if (!re.test(s)) { console.error('未匹配到 ' + k); process.exit(1); }
  s = s.replace(re, '$1' + addr + '$3');
}
fs.writeFileSync(file, s);
console.log('✓ contracts.ts 已更新：');
for (const [k, a] of Object.entries(map)) console.log('  ' + k + ' = ' + a);
EOF
node /tmp/patch-addr.js || die "回填地址失败（请手动改 contracts.ts）"

# --- 5. 启动 FHE-API -----------------------------------------------------------
say "5. 启动 FHE-API (:3000)，二次启动因有缓存通常很快"
tmux new -s api -d "cd '$FHE_API' && cargo run --release" || die "无法创建 api 会话"
ok=""
for i in $(seq 1 240); do
  if curl -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then ok=1; break; fi
  if ! tmux has-session -t api 2>/dev/null; then break; fi
  sleep 2
done
[ -n "$ok" ] || die "FHE-API 未就绪，请 tmux attach -t api 看日志"
echo "✓ FHE-API 已就绪"

# --- 6. 启动前端 ----------------------------------------------------------------
say "6. 启动前端 (:5173)"
tmux new -s web -d "cd '$FHE_WEB' && npm run dev -- --host 0.0.0.0" || die "无法创建 web 会话"
ok=""
for i in $(seq 1 30); do
  curl -s http://127.0.0.1:5173/ -o /dev/null 2>/dev/null && { ok=1; break; }
  sleep 2
done
[ -n "$ok" ] || die "前端未就绪，请 tmux attach -t web 看日志"
echo "✓ 前端已就绪"

# --- 7. 收尾提示 ----------------------------------------------------------------
say "全部启动完成 🎉"
echo "运行中的会话："
tmux ls | grep -E '\b(chain|api|web)\b'
echo
echo "接下来你需要做："
echo "  1) 本地开隧道访问:  ssh -N -L 5173:127.0.0.1:5173 -p <端口> root@<IP>"
echo "  2) 浏览器打开 http://localhost:5173"
echo "  3) 用户重新生成 FHE 密钥(FHE-API 内存态，重启即丢): 在页点 Generate FHE Keys"
echo "  4) 若仍需旧链上数据=不可能(内存链)；但代码/依赖均已恢复"
echo "日志查看: tmux attach -t chain|api|web (退出 Ctrl+B 然后 D)"

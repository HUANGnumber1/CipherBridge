#!/usr/bin/env bash
# ============================================================================
# env_setup.sh — CipherBridge 环境初始化（本机 Ubuntu 22.04, root）
# 依据：docs/ 与 remote-setup/ZHIXINGYUN_GUIDE.md 第3~5步
# 用法：bash env_setup.sh             # 默认全量初始化
#       bash env_setup.sh --risczero  # 额外安装 RISC Zero（跑 ZK demo 才需要）
# 日志：/tmp/env_setup.log
# 幂等：可重复执行
# ============================================================================
exec > /tmp/env_setup.log 2>&1
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
ROOT=/root/Bisai
stamp(){ echo; echo "################## $* ##################"; date '+%F %T'; }
rc(){ echo "  [exit=$?] $*"; }

# ---- 参数解析：--risczero 额外安装 RISC Zero（默认不装，保持与旧行为兼容）----
DO_RISC0=${DO_RISC0:-0}
for a in "$@"; do
  case "$a" in
    --risczero) DO_RISC0=1 ;;
    *) echo "忽略未知参数: $a (可用: --risczero)" ;;
  esac
done

stamp "STAGE 1: apt update + 系统基础依赖"
apt-get update
apt-get install -y curl wget build-essential cmake git pkg-config tmux unzip \
                   libssl-dev libgomp1 ca-certificates
rc "apt install base"
for b in curl wget cmake gcc g++ make tmux git; do printf '  %-8s %s\n' "$b" "$(command -v $b || echo MISSING)"; done

stamp "STAGE 2: Node.js 20 (npmmirror tarball)"
if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/v//;s/\..*//')" -ge 18 ] 2>/dev/null; then
  echo "node 已存在: $(node -v)"
else
  NODE_VER=v20.18.0
  wget -q -O /tmp/node.tar.xz "https://npmmirror.com/mirrors/node/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz" \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rc "install node ${NODE_VER}"
fi
echo "node=$(node -v 2>&1)  npm=$(npm -v 2>&1)"

stamp "STAGE 3: Rust toolchain (rsproxy)"
if command -v cargo >/dev/null 2>&1; then
  echo "cargo 已存在: $(cargo -V)"
else
  export RUSTUP_DIST_SERVER=https://rsproxy.cn
  export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
  curl --proto '=https' --tlsv1.2 -sSf https://rsproxy.cn/rustup-init.sh | sh -s -- -y
  rc "rustup-init"
fi
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
echo "cargo=$(cargo -V 2>&1)  rustc=$(rustc -V 2>&1)"

stamp "STAGE 4: cargo crates 镜像 (rsproxy)"
mkdir -p "$HOME/.cargo"
if grep -q 'rsproxy-sparse' "$HOME/.cargo/config.toml" 2>/dev/null; then
  echo "cargo 镜像已配置，跳过"
else
  cat >> "$HOME/.cargo/config.toml" <<'EOF'

[source.crates-io]
replace-with = "rsproxy-sparse"

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"

[net]
git-fetch-with-cli = true
EOF
  echo "cargo 镜像已写入 ~/.cargo/config.toml"
fi

stamp "STAGE 5: 项目代码适配（幂等补丁，依据指南第5步）"
FHE_API="$ROOT/FHE-API"
ZK_GUEST="$ROOT/ZK-Compuation-Proof/hello-world-7/methods/guest/Cargo.toml"
# 5.1 注释 sccache wrapper
[ -f "$FHE_API/.cargo/config.toml" ] && sed -i 's/^rustc-wrapper.*/#&/' "$FHE_API/.cargo/config.toml"
# 5.2 去掉 tfhe gpu feature（无 CUDA 工具链）
[ -f "$FHE_API/Cargo.toml" ] && sed -i 's/"integer", "x86_64-unix", "gpu"/"integer", "x86_64-unix"/' "$FHE_API/Cargo.toml"
# 5.3 修复 ZK demo 硬编码 macOS 路径
[ -f "$ZK_GUEST" ] && sed -i 's#/Users/farhadnouri/Desktop/IEEE_Globecom/tfhe-rs-main/tfhe#../../../tfhe-rs-main/tfhe#' "$ZK_GUEST"
echo "--- FHE-API/Cargo.toml tfhe 行 ---"; grep -n 'tfhe' "$FHE_API/Cargo.toml"
echo "--- FHE-API/.cargo/config.toml ---"; sed -n '1,6p' "$FHE_API/.cargo/config.toml"

stamp "STAGE 6: npm 依赖（Protocol / Frontend，npmmirror 源）"
npm config set registry https://registry.npmmirror.com
(cd "$ROOT/FHE-Protocol" && npm install) ; rc "FHE-Protocol npm install"
(cd "$ROOT/FHE-Frontend" && npm install) ; rc "FHE-Frontend npm install"
echo "Protocol node_modules: $(ls -d "$ROOT/FHE-Protocol/node_modules" 2>/dev/null || echo MISSING)"
echo "Frontend node_modules: $(ls -d "$ROOT/FHE-Frontend/node_modules" 2>/dev/null || echo MISSING)"

stamp "STAGE 7: RISC Zero 工具链（可选，需 --risczero）"
if [ "$DO_RISC0" = "1" ]; then
  if command -v rzup >/dev/null 2>&1; then
    echo "rzup 已存在，跳过安装: $(command -v rzup)"
  else
    curl -L https://risczero.com/install | bash ; rc "risczero 安装脚本"
    export PATH="$HOME/.risc0/bin:$PATH"
  fi
  if command -v rzup >/dev/null 2>&1; then
    rzup install 2>/dev/null ; rc "rzup install（正式证明需核对版本与 risc0-zkvm 一致，日常用 dev-mode）"
  else
    echo "  [WARN] rzup 未找到——安装脚本可能因网络失败；可稍后手动: rzup install"
  fi
else
  echo "跳过（跑 ZK demo 需要时用: bash $0 --risczero）"
fi

stamp "STAGE 8: 环境初始化完成"
echo "node=$(node -v) npm=$(npm -v) cargo=$(cargo -V 2>&1) rzup=$(command -v rzup || echo 未安装)"
touch /tmp/env_setup.done

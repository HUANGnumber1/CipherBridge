#!/usr/bin/env bash
# ============================================================================
# setup_zhixing.sh — CipherBridge · 智星云实例一键初始化脚本
#
# 用途：SSH/Trae 连上云实例后，把“系统环境 + 代码适配”一次性配好。
#       幂等：可重复执行，不会重复安装或重复打补丁。
#
# 用法：
#   bash setup_zhixing.sh                 # 基础配置（最常用）
#   bash setup_zhixing.sh --mirror        # 额外：换国内 apt 源（大陆环境推荐）
#   bash setup_zhixing.sh --npm           # 额外：安装 Protocol/Frontend 依赖
#   bash setup_zhixing.sh --build         # 额外：后台启动 FHE-API release 编译
#   bash setup_zhixing.sh --risczero      # 额外：安装 RISC Zero（跑 ZK demo 才需要）
# 参数可组合，例如: bash setup_zhixing.sh --mirror --npm --build
#
# 前提：代码已放在 /root/Bisai（可用 ROOT=... 覆盖）
# ============================================================================
set -uo pipefail

ROOT="${ROOT:-/root/Bisai}"
DO_APT_MIRROR=0
DO_NPM=0
DO_BUILD=0
DO_RISC0=0

for a in "$@"; do
  case "$a" in
    --mirror)   DO_APT_MIRROR=1 ;;
    --npm)      DO_NPM=1 ;;
    --build)    DO_BUILD=1 ;;
    --risczero) DO_RISC0=1 ;;
    *) echo "忽略未知参数: $a (可用的: --mirror --npm --build --risczero)" ;;
  esac
done

say(){ echo; echo "==================== $* ===================="; }
ok(){  echo "  [OK] $*"; }
warn(){ echo "  [!!] $*"; }
die(){ echo; echo "[FATAL] $*"; echo "处理建议：按上方提示修复后，重新执行本脚本即可（脚本幂等，可重复跑）。"; exit 1; }

# 问题记录：可选步骤失败仅记录，不中断；结束统一汇报
PROBLEMS=()
note(){ warn "$*"; PROBLEMS+=("$*"); }
report(){
  if [ "${#PROBLEMS[@]}" -gt 0 ]; then
    echo
    echo "==================== ⚠ 本次存在 ${#PROBLEMS[@]} 个问题 ===================="
    local i=1
    for p in "${PROBLEMS[@]}"; do echo "  $i. $p"; i=$((i+1)); done
    echo "修复后重跑: bash $0 $*"
  else
    echo
    echo "==================== ✅ 全部关键步骤通过，无遗留问题 ===================="
  fi
}

# ---------- A. 系统基础依赖 ----------
say "A. 安装系统基础依赖 (apt)"
if ! sudo apt-get update -qq; then
  if [ "$DO_APT_MIRROR" = "1" ]; then
    die "apt update 失败——请检查网络或镜像配置后重跑"
  else
    note "apt update 失败（可能是网络受限）；建议改用：bash $0 --mirror"
    die "apt update 失败，无法继续安装系统依赖"
  fi
fi
if ! sudo apt-get install -y build-essential cmake git curl pkg-config tmux unzip \
                             libssl-dev libgomp1 ca-certificates; then
  die "系统依赖安装失败——请检查网络/磁盘空间后重跑（可先加 --mirror）"
fi
ok "系统依赖安装完成"

if [ "$DO_APT_MIRROR" = "1" ]; then
  say "A2. 换国内 apt 源（清华镜像，Ubuntu 20.04/22.04 通用）"
  sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak 2>/dev/null || true
  sudo sed -i 's@//.*archive.ubuntu.com@//mirrors.tuna.tsinghua.edu.cn@g; s@//security.ubuntu.com@//mirrors.tuna.tsinghua.edu.cn@g; s@//ports.ubuntu.com@//mirrors.tuna.tsinghua.edu.cn@g' /etc/apt/sources.list
  sudo apt-get update -qq
  ok "apt 已切换到清华源（原文件备份为 sources.list.bak）"
fi

# ---------- B. Node.js 20 ----------
say "B. 检查/安装 Node.js (>=18)"
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v//;s/\..*$//')
if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then
  ok "Node 已存在: $(node -v)"
else
  if ! curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -; then
    die "NodeSource 源添加失败（网络？）——修复网络后重跑本脚本"
  fi
  if ! sudo apt-get install -y nodejs; then
    die "nodejs 安装失败——请检查 apt 源/网络后重跑"
  fi
  NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v//;s/\..*$//')
  if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 18 ]; then
    die "Node 安装后版本异常: $(node -v 2>/dev/null)，请手动安装 Node >= 18 后重跑"
  fi
  ok "Node: $(node -v)  npm: $(npm -v)"
fi

# ---------- C. Rust（国内走 rsproxy 镜像） ----------
say "C. 检查/安装 Rust"
if command -v cargo >/dev/null 2>&1; then
  ok "cargo 已存在: $(cargo -V)"
else
  export RUSTUP_DIST_SERVER=https://rsproxy.cn
  export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
  if ! curl --proto '=https' --tlsv1.2 -sSf https://rsproxy.cn/rustup-init.sh -o /tmp/rustup-init.sh; then
    note "rsproxy 镜像下载 rustup-init 失败，改用官方源重试"
    unset RUSTUP_DIST_SERVER RUSTUP_UPDATE_ROOT
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup-init.sh \
      || die "rustup-init 下载失败（网络？）——修复网络后重跑本脚本"
  fi
  sh /tmp/rustup-init.sh -y --default-toolchain stable --profile minimal \
    || die "rust 安装失败——请根据上方输出修复后重跑本脚本"
fi
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi
command -v cargo >/dev/null 2>&1 || die "cargo 不在 PATH——请执行 source ~/.cargo/env 或重装 rust"
ok "rustc: $(rustc -V 2>/dev/null)  cargo: $(cargo -V 2>/dev/null)"

# ---------- D. crates.io 国内镜像 ----------
say "D. 配置 crates.io 国内镜像 (rsproxy-sparse)"
mkdir -p "$HOME/.cargo"
if grep -q 'rsproxy-sparse' "$HOME/.cargo/config.toml" 2>/dev/null; then
  ok "cargo 镜像已配置，跳过"
else
  cat >> "$HOME/.cargo/config.toml" <<'EOF'

[source.crates-io]
replace-with = "rsproxy-sparse"

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"

[net]
git-fetch-with-cli = true
EOF
  ok "cargo 镜像配置完成"
fi

# ---------- E. 项目代码适配（幂等补丁） ----------
say "E. 适配项目代码（幂等，重复执行无害）"
if [ ! -d "$ROOT" ]; then
  note "找不到 $ROOT —— 代码未上传：请先在本地把整个 Bisai 传到 /root（见指南第4步）"
  note "E 段代码补丁被跳过，其余配置不受影响；补丁可在代码上传后重跑本脚本完成。"
else
  FHE_API="$ROOT/FHE-API"
  ZK_GUEST="$ROOT/ZK-Compuation-Proof/hello-world-7/methods/guest/Cargo.toml"

  # E1. 注释 sccache wrapper（没装 sccache 时 cargo 会失败）
  [ -f "$FHE_API/.cargo/config.toml" ] && \
    sed -i 's/^rustc-wrapper.*/#&/' "$FHE_API/.cargo/config.toml"
  ok "E1 已处理 FHE-API .cargo/config.toml 的 sccache wrapper"

  # E2. 去掉 tfhe 的 gpu feature（云端无 CUDA 工具链时编译不过）
  [ -f "$FHE_API/Cargo.toml" ] && \
    sed -i 's/"integer", "x86_64-unix", "gpu"/"integer", "x86_64-unix"/' "$FHE_API/Cargo.toml"
  ok "E2 已去除 FHE-API 的 gpu feature"
  grep -n 'features' "$FHE_API/Cargo.toml" 2>/dev/null | sed 's/^/      /'

  # E3. 修复 ZK demo 的 macOS 硬编码绝对路径
  if [ -f "$ZK_GUEST" ]; then
    sed -i 's#/Users/farhadnouri/Desktop/IEEE_Globecom/tfhe-rs-main/tfhe#../../../tfhe-rs-main/tfhe#' "$ZK_GUEST"
    ok "E3 已修复 hello-world guest 的 tfhe 路径"
  fi
fi

# ---------- F.（可选）npm 依赖 ----------
if [ "$DO_NPM" = "1" ]; then
  say "F. 安装 npm 依赖（FHE-Protocol / FHE-Frontend）"
  npm config set registry https://registry.npmmirror.com 2>/dev/null || true
  [ -d "$ROOT/FHE-Protocol" ] && (cd "$ROOT/FHE-Protocol" && npm install) \
    || note "FHE-Protocol npm install 失败（网络/源问题？）——修复后重跑本脚本"
  [ -d "$ROOT/FHE-Frontend" ] && (cd "$ROOT/FHE-Frontend" && npm install) \
    || note "FHE-Frontend npm install 失败（网络/源问题？）——修复后重跑本脚本"
  ok "npm 依赖处理完成"
fi

# ---------- G.（可选）RISC Zero ----------
if [ "$DO_RISC0" = "1" ]; then
  say "G. 安装 RISC Zero（rzup，用于 ZK demo）"
  curl -L https://risczero.com/install | bash || note "risczero 安装脚本下载失败（网络？）——可在网络恢复后重跑本脚本 --risczero"
  export PATH="$HOME/.risc0/bin:$PATH"
  rzup install 2>/dev/null || note "rzup install 失败——可稍后手动执行 rzup install，或使用 dev-mode 跳过证明"
  ok "RISC Zero 处理完成（正式证明需核对版本与 risc0-zkvm 一致，日常用 dev-mode）"
fi

# ---------- H.（可选）后台编译 FHE-API ----------
if [ "$DO_BUILD" = "1" ]; then
  say "H. 后台编译 FHE-API (release)，日志 /tmp/fhe_build.log"
  if [ -d "$ROOT/FHE-API" ]; then
    tmux kill-session -t build 2>/dev/null || true
    tmux new -s build "bash -lc 'cd $ROOT/FHE-API && cargo build --release 2>&1 | tee /tmp/fhe_build.log'"
    ok "编译已在 tmux(build) 后台进行；查看进度: tail -f /tmp/fhe_build.log"
  else
    note "无 $ROOT/FHE-API，跳过编译（先上传代码再重跑本脚本 --build）"
  fi
fi

# ---------- 收尾 ----------
say "初始化流程执行结束（汇总见下）"
echo "当前 tmux 会话："; tmux ls 2>/dev/null || echo "  (暂无服务会话)"
echo
echo "接下来按需执行："
echo "  1) 若代码还没上传： 本地执行 scp 把整个 Bisai 传到 /root"
echo "  2) 上传 resume_zhixing.sh 后一键起服务+部署："
echo "       sed -i 's/\r\$//' /root/resume_zhixing.sh   # 去掉 Windows 换行符"
echo "       bash /root/resume_zhixing.sh"
echo "  3) 本地访问前端：    ssh -N -L 5173:127.0.0.1:5173 -p <端口> root@<IP>"
echo "       然后浏览器打开 http://localhost:5173"
echo "  4) 日志查看：        tail -f /tmp/fhe_build.log /tmp/fhe_api.log /tmp/chain.log /tmp/web.log"

report "$@"

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  echo
  echo ">>> ⚠ 存在 ${#PROBLEMS[@]} 个未完成/警告项：请按上方 [!!] 与问题清单处理；"
  echo ">>> 处理完成后可随时重跑：bash $0 $*（脚本幂等，重复执行安全）。"
  exit 1
fi
exit 0



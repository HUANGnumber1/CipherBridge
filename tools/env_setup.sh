#!/usr/bin/env bash
# ============================================================================
# env_setup.sh — CipherBridge 环境初始化（本机 Ubuntu, root）
#
# 【并行优化】把互不依赖的步骤放到后台并行执行（bash 多进程：& + wait），
#   缩短总耗时。阶段划分：
#     STAGE 1  apt 基础依赖 ................ 串行（apt 独占锁，无法并行）
#     STAGE 2  Node ‖ Rust ‖ 代码补丁 ...... 3 任务并行   <-- 主要提速点
#     STAGE 3  cargo crates 镜像 + rust-src ... 串行（须等 Rust 完成）
#     STAGE 4  npm(Protocol) ‖ npm(Frontend) ‖ RISC Zero ... 2~3 任务并行
#     STAGE 5  汇总
#     STAGE 6  完成（--build 时自动接续后台编译）
#
# 用法：
#   bash env_setup.sh                     # 默认并行（最快）
#   bash env_setup.sh --risczero          # 额外安装 RISC Zero（跑 ZK demo）
#   bash env_setup.sh --build             # 完成后 tmux 后台编译 FHE-API(release)
#   bash env_setup.sh --risczero --build
#   bash env_setup.sh --serial            # 串行模式（低配/排障用）
#
# 日志：主日志 /tmp/env_setup.log
#       并行子任务 /tmp/env_setup.<task>.log（node/rust/patch/npm_*/risczero）
# 标记：完成 /tmp/env_setup.done   有失败 /tmp/env_setup.fail
# 幂等：可重复执行；已完成的步骤会自动跳过
# ============================================================================
exec > /tmp/env_setup.log 2>&1
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
ROOT=${ROOT:-/root/Bisai}
NODE_VER=${NODE_VER:-v20.18.0}
NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmmirror.com}

PROBLEMS=()
stamp(){ echo; echo "################## $* ##################"; date '+%F %T'; }
rc(){ echo "  [exit=$?] $*"; }
note(){ echo "  [!!] $*"; PROBLEMS+=("$*"); }

# ---- 参数解析 ----
DO_RISC0=${DO_RISC0:-0}
DO_BUILD=${DO_BUILD:-0}
PARALLEL=${PARALLEL:-1}
for a in "$@"; do
  case "$a" in
    --risczero) DO_RISC0=1 ;;
    --build)    DO_BUILD=1 ;;
    --serial)   PARALLEL=0 ;;
    *) echo "忽略未知参数: $a (可用: --risczero --build --serial)" ;;
  esac
done

# ============================================================================
# 并行调度工具
#   job <name> <func> [args...]  —— 并行模式后台跑(输出到独立日志)；串行模式前台跑
#   wait_all                     —— 等待本阶段全部后台任务并收集结果
# ============================================================================
P_NAMES=(); P_PIDS=()

_collect(){ # _collect <name> <pid>
  local name="$1" pid="$2"
  if wait "$pid"; then
    echo "  [OK ] $name"
  else
    echo "  [!! ] $name 失败，日志尾部："
    tail -n 8 "/tmp/env_setup.${name}.log" 2>/dev/null | sed 's/^/         /'
    note "$name 失败（完整日志 /tmp/env_setup.${name}.log）"
  fi
}

job(){ # job <name> <func> [args...]
  local name="$1"; shift
  if [ "$PARALLEL" = "1" ]; then
    ( "$@" ) > "/tmp/env_setup.${name}.log" 2>&1 &
    P_NAMES+=("$name"); P_PIDS+=("$!")
    echo "  [BG ] $name 已后台启动 pid=$!  -> /tmp/env_setup.${name}.log"
  else
    echo "  [RUN] $name（串行，输出同时进主日志）..."
    if ( "$@" ) 2>&1 | tee "/tmp/env_setup.${name}.log"; then
      echo "  [OK ] $name"
    else
      echo "  [!! ] $name 失败，日志尾部："
      tail -n 8 "/tmp/env_setup.${name}.log" 2>/dev/null | sed 's/^/         /'
      note "$name 失败（完整日志 /tmp/env_setup.${name}.log）"
    fi
  fi
}

wait_all(){
  local i
  if [ "${#P_PIDS[@]}" -gt 0 ]; then
    for i in "${!P_PIDS[@]}"; do _collect "${P_NAMES[$i]}" "${P_PIDS[$i]}"; done
    P_NAMES=(); P_PIDS=()
  fi
  echo "  ---- 本阶段并行任务已全部结束 ----"
}

# ============================================================================
# 任务函数（每个都在独立子 shell 中执行，环境互不干扰）
# ============================================================================

task_node(){  # Node.js 20（npmmirror 二进制包 → /usr/local）
  if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/v//;s/\..*//')" -ge 18 ] 2>/dev/null; then
    echo "node 已存在: $(node -v)，跳过安装"
    return 0
  fi
  echo "下载并解压 Node ${NODE_VER} ..."
  wget -q -O /tmp/node.tar.xz \
    "https://npmmirror.com/mirrors/node/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz" \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  local r=$?
  hash -r 2>/dev/null || true
  echo "node=$(node -v 2>&1)  npm=$(npm -v 2>&1)"
  return $r
}

task_rust(){  # Rust toolchain（rsproxy 镜像）
  if command -v cargo >/dev/null 2>&1; then
    echo "cargo 已存在: $(cargo -V)，跳过安装"
    return 0
  fi
  export RUSTUP_DIST_SERVER=https://rsproxy.cn
  export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
  echo "通过 rsproxy 安装 Rust ..."
  curl --proto '=https' --tlsv1.2 -sSf https://rsproxy.cn/rustup-init.sh | sh -s -- -y
  local r=$?
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
  echo "cargo=$(cargo -V 2>&1)  rustc=$(rustc -V 2>&1)"
  return $r
}

task_rust_src(){  # rust-src 组件（两个 ZK 项目的 rust-toolchain.toml 都声明了它）
  if ! command -v rustup >/dev/null 2>&1; then
    echo "rustup 不存在，跳过 rust-src"
    return 0
  fi
  if rustup component list --toolchain stable 2>/dev/null | grep -q '^rust-src (installed)'; then
    echo "rust-src 已安装，跳过"
    return 0
  fi
  echo "安装 rust-src 组件（ZK 项目首次 cargo run 需要）..."
  rustup component add rust-src --toolchain stable
}

task_patch(){  # 项目代码适配（幂等补丁）
  local FHE_API="$ROOT/FHE-API"
  local ZK_GUEST="$ROOT/ZK-Compuation-Proof/hello-world-7/methods/guest/Cargo.toml"
  local ZK_HOST="$ROOT/ZK-Compuation-Proof/hello-world-7/host/Cargo.toml"
  local ZK2_GUEST="$ROOT/zkFHE-Decryption-Proof/decryption-proof/methods/guest/Cargo.toml"
  local n=0
  if [ -f "$FHE_API/.cargo/config.toml" ]; then
    sed -i 's/^rustc-wrapper.*/#&/' "$FHE_API/.cargo/config.toml" && n=$((n+1))
  else
    echo "[WARN] 未找到 $FHE_API/.cargo/config.toml（代码是否已上传？）"
  fi
  if [ -f "$FHE_API/Cargo.toml" ]; then
    sed -i 's/"integer", "x86_64-unix", "gpu"/"integer", "x86_64-unix"/' "$FHE_API/Cargo.toml" && n=$((n+1))
  fi
  if [ -f "$ZK_GUEST" ]; then
    sed -i 's#/Users/farhadnouri/Desktop/IEEE_Globecom/tfhe-rs-main/tfhe#../../../tfhe-rs-main/tfhe#' "$ZK_GUEST" && n=$((n+1))
  fi
  if [ -f "$ZK_HOST" ]; then
    # 原作者 macOS 配置是 aarch64-unix；在 x86_64 机器上 concrete-csprng 会因
    # 特性 generator_aarch64_aes 直接编译失败（exit 101），必须改为 x86_64-unix
    sed -i 's/"aarch64-unix"/"x86_64-unix"/' "$ZK_HOST" && n=$((n+1))
  fi
  if [ -f "$ZK2_GUEST" ]; then
    # decryption-proof 的 guest 要反序列化约 90MB 大密钥；risc0 默认 bump 分配器不回收内存，
    # 会在 zkVM 内报 “Out of memory! ... Enable the heap-embedded-alloc feature”，故这里开启
    sed -i "s/features = \\['std'\\]/features = ['std', 'heap-embedded-alloc']/" "$ZK2_GUEST" && n=$((n+1))
    # heap-embedded-alloc 依赖 embedded-alloc 0.6.0（用的是 Layout::dangling()）；该名字在较新 rustc 上
    # 已改名 dangling_ptr()。**该用哪个名字取决于编译 guest 的那个 rustc**（guest 由 risc0 guest 工具链
    # rust 1.85.0 编译 → 仍是 dangling()）。这里只保证 vendor 副本在位，改名统一交给 setup_zk_env.sh 探测。
    local VENDOR="$ROOT/zkFHE-Decryption-Proof/vendor/embedded-alloc-0.6.0"
    if [ ! -d "$VENDOR" ]; then
      local esrc
      esrc=$(ls -d "$HOME/.cargo/registry/src/"*/embedded-alloc-0.6.0 2>/dev/null | head -1)
      if [ -z "$esrc" ]; then
        # 缓存里还没有：先 fetch 一次（此时尚未写入 patch 段，fetch 可用）
        echo "  触发 guest 依赖下载（embedded-alloc 0.6.0）..."
        ( cd "$(dirname "$ZK2_GUEST")" && cargo fetch --target riscv32im-risc0-zkvm-elf >/dev/null 2>&1 )
        esrc=$(ls -d "$HOME/.cargo/registry/src/"*/embedded-alloc-0.6.0 2>/dev/null | head -1)
      fi
      if [ -n "$esrc" ]; then
        mkdir -p "$ROOT/zkFHE-Decryption-Proof/vendor"
        cp -r "$esrc" "$VENDOR" && chmod -R u+w "$VENDOR"
        echo "  已生成 vendor 副本: $VENDOR（API 名字交给 setup_zk_env.sh 按 guest 工具链校正）"
        n=$((n+1))
      else
        echo "  [WARN] 未取得 embedded-alloc-0.6.0 源码，无法生成 vendor 副本"
      fi
    fi
    if [ -d "$VENDOR" ] && ! grep -q '^\[patch.crates-io\]' "$ZK2_GUEST" 2>/dev/null; then
      printf '\n# embedded-alloc 0.6.0 的 Layout::dangling 命名随 rustc 变化；用 vendor 副本 + setup_zk_env.sh 校正\n[patch.crates-io]\nembedded-alloc = { path = "../../../vendor/embedded-alloc-0.6.0" }\n' >> "$ZK2_GUEST"
      n=$((n+1))
    fi
    # 校正 vendor 里的 Layout 悬垂指针方法名（探测 risc0 guest 工具链 → dangling() 还是 dangling_ptr()）
    if [ -x "$ROOT/tools/setup_zk_env.sh" ]; then
      bash "$ROOT/tools/setup_zk_env.sh" --patch-only >/dev/null 2>&1 && n=$((n+1)) \
        || echo "  [WARN] setup_zk_env.sh --patch-only 有失败项（见 /tmp/zk_env_setup.patch.log）"
    fi
  fi
  echo "已处理 $n 处补丁（幂等，重复执行无副作用）"
  echo "--- FHE-API/Cargo.toml 的 tfhe 行 ---"
  grep -n 'tfhe' "$FHE_API/Cargo.toml" 2>/dev/null || true
}

task_cargo_mirror(){  # cargo crates 镜像（必须在 Rust 完成后执行）
  mkdir -p "$HOME/.cargo"
  if grep -q 'rsproxy-sparse' "$HOME/.cargo/config.toml" 2>/dev/null; then
    echo "cargo 镜像已配置，跳过"
    return 0
  fi
  cat >> "$HOME/.cargo/config.toml" <<'EOF'

[source.crates-io]
replace-with = "rsproxy-sparse"

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"

[net]
git-fetch-with-cli = true
EOF
  echo "cargo 镜像已写入 $HOME/.cargo/config.toml"
}

task_npm(){  # task_npm <子目录>；--no-audit --no-fund 可明显缩短安装时间
  local sub="$1"
  local dir="$ROOT/$1"
  if [ ! -d "$dir" ]; then
    echo "[WARN] 目录不存在: $dir（代码未上传？）"
    return 0
  fi
  cd "$dir" || return 1
  echo "npm install ($sub)，registry=$NPM_REGISTRY"
  npm install --no-audit --no-fund --prefer-offline
  echo "$sub node_modules: $(ls -d node_modules 2>/dev/null || echo MISSING)"
}

task_risczero(){  # RISC Zero 工具链（rzup）
  export PATH="$HOME/.risc0/bin:$PATH"
  if command -v rzup >/dev/null 2>&1; then
    echo "rzup 已存在: $(command -v rzup)，跳过安装脚本"
  else
    echo "安装 RISC Zero（rzup）..."
    curl -L https://risczero.com/install | bash || return 1
    export PATH="$HOME/.risc0/bin:$PATH"
  fi
  if command -v rzup >/dev/null 2>&1; then
    echo "执行 rzup install ..."
    rzup install
  else
    echo "[WARN] rzup 未找到——网络问题？可稍后手动执行 rzup install"
    return 1
  fi
  # 两个 ZK demo（ZK-Compuation-Proof / zkFHE-Decryption-Proof）的 Cargo.lock 都解析到 risc0-zkvm 1.2.6：
  #   · r0vm 服务端必须与 risc0-zkvm 同 major.minor，否则 prove() 直接报 “not compatible”
  #   · 还需要同版本的 cargo-risczero（host 靠它编 guest）
  #   · 以及 rzup 注册的、名为 "risc0" 的 guest Rust 工具链（1.2.6 对应 rust 1.85.0），
  #     否则 guest 编译会报 “The 'risc0' toolchain could not be found / To install the risc0 toolchain, use rzup”
  #   完整逻辑（含探测 embedded-alloc 的 Layout 方法名）见 tools/setup_zk_env.sh
  if ls "$HOME/.risc0/extensions/"v1.2.6-cargo-risczero-*/r0vm >/dev/null 2>&1; then
    echo "risc0 1.2.6 的 cargo-risczero/r0vm 已存在，跳过"
  else
    echo "安装 cargo-risczero / r0vm 1.2.6（两个 ZK demo 用 risc0-zkvm 1.2.6）..."
    rzup install cargo-risczero 1.2.6 \
      || echo "[WARN] cargo-risczero 1.2.6 安装失败；跑 ZK demo 前需手动: rzup install cargo-risczero 1.2.6"
    rzup install r0vm 1.2.6 \
      || echo "[WARN] r0vm 1.2.6 安装失败；跑 ZK demo 前需手动: rzup install r0vm 1.2.6"
  fi
  if rustup toolchain list 2>/dev/null | grep -q '^risc0'; then
    echo "risc0 guest 工具链已注册，跳过"
  else
    echo "安装 risc0 guest Rust 工具链（rust 1.85.0）..."
    rzup install rust 1.85.0 \
      || echo "[WARN] rust 1.85.0 安装失败；跑 ZK demo 前需手动: rzup install rust 1.85.0"
  fi
}

# ============================================================================
# STAGE 1：apt 基础依赖（串行 —— apt 独占锁，必须最先完成）
# ============================================================================
stamp "STAGE 1: apt update + 系统基础依赖（串行）"
apt-get update -o Acquire::Retries=3
apt-get install -y -o Dpkg::Options::="--force-confold" -o Acquire::Retries=3 \
  curl wget build-essential cmake git pkg-config tmux unzip \
  libssl-dev libgomp1 ca-certificates
rc "apt install base"
for b in curl wget cmake gcc g++ make tmux git; do printf '  %-8s %s\n' "$b" "$(command -v $b || echo MISSING)"; done
hash -r 2>/dev/null || true

if [ -d "$ROOT/FHE-Protocol" ]; then
  echo "  代码目录: $ROOT （已就位）"
else
  echo "  [WARN] 未发现 $ROOT/FHE-Protocol —— 代码尚未上传？补丁/npm 将自动跳过"
fi

# ============================================================================
# STAGE 2：Node ‖ Rust ‖ 代码补丁 —— 三任务并行（互不依赖）
#   原串行耗时 = t(node)+t(rust)+t(patch)；并行后 ≈ max(...)，主要提速点
# ============================================================================
stamp "STAGE 2: 并行初始化 —— Node ‖ Rust ‖ 代码补丁"
job node  task_node
job rust  task_rust
job patch task_patch
wait_all

# 让主进程也用上刚装好的工具链（子 shell 的 export 不影响父进程）
hash -r 2>/dev/null || true
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export PATH="$HOME/.cargo/bin:$PATH"
echo "  node=$(command -v node || echo MISSING)  cargo=$(command -v cargo || echo MISSING)"

# ============================================================================
# STAGE 3：cargo crates 镜像（串行，必须在 Rust 安装完成后）
# ============================================================================
stamp "STAGE 3: cargo crates 镜像 (rsproxy) + rust-src 组件"
if task_cargo_mirror; then echo "  [OK ] cargo 镜像"; else note "cargo 镜像配置失败"; fi
# 3b. rust-src 组件：ZK 项目 rust-toolchain.toml 需要，缺失会在首次 cargo run 时临时下载
if task_rust_src; then echo "  [OK ] rust-src"; else note "rust-src 安装失败（ZK 首次运行时会自动重试下载）"; fi

# ============================================================================
# STAGE 4：npm(Protocol) ‖ npm(Frontend) ‖ RISC Zero —— 并行
#   原串行 = 两次 npm install + rzup；并行后 ≈ max(...)
# ============================================================================
stamp "STAGE 4: 并行安装 —— npm(Protocol) ‖ npm(Frontend) ‖ RISC Zero"
npm config set registry "$NPM_REGISTRY" >/dev/null 2>&1 || true
job npm_protocol task_npm FHE-Protocol
job npm_frontend task_npm FHE-Frontend
if [ "$DO_RISC0" = "1" ]; then
  job risczero task_risczero
else
  echo "  [SKIP] RISC Zero（需要时加 --risczero）"
fi
wait_all

# ============================================================================
# STAGE 5：汇总
# ============================================================================
stamp "STAGE 5: 汇总"
if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  echo "===== 本次存在 ${#PROBLEMS[@]} 个问题 ====="
  i=1
  for p in "${PROBLEMS[@]}"; do echo "  $i. $p"; i=$((i+1)); done
  echo "修复后可原样重跑（脚本幂等）: bash $0 $*"
  touch /tmp/env_setup.fail
else
  echo "===== 全部通过，无遗留问题 ====="
  rm -f /tmp/env_setup.fail
fi

# ============================================================================
# STAGE 6：完成
# ============================================================================
stamp "STAGE 6: 环境初始化完成"
echo "node=$(node -v 2>&1) npm=$(npm -v 2>&1) cargo=$(cargo -V 2>&1) rzup=$(command -v rzup 2>/dev/null || echo 未安装)"
touch /tmp/env_setup.done

# ============================================================================
# STAGE 7：（可选）自动接续后台编译 FHE-API（--build）
#   编译是后续最耗时的一步，环境一就绪就立刻放后台跑，进一步省总时间
# ============================================================================
if [ "$DO_BUILD" = "1" ] && [ "${#PROBLEMS[@]}" -eq 0 ]; then
  stamp "STAGE 7: 后台编译 FHE-API (release)"
  if [ -x "$ROOT/tools/build_fhe.sh" ]; then
    tmux kill-session -t build 2>/dev/null || true
    tmux new -d -s build "bash '$ROOT/tools/build_fhe.sh'"
    echo "已在 tmux(build) 后台编译；查看进度: tail -f /tmp/fhe_build.log"
  else
    echo "[WARN] 未找到可执行的 $ROOT/tools/build_fhe.sh"
  fi
fi

if [ "${#PROBLEMS[@]}" -gt 0 ]; then exit 1; fi
exit 0

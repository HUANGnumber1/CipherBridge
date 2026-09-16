#!/usr/bin/env bash
# ============================================================================
# setup_zk_env.sh — 两个 ZK 验证项目（RISC Zero）运行环境一键配置
#
# 适用对象（两个项目都用 risc0-zkvm 1.2.6，见各自 Cargo.lock）：
#   ZK-Compuation-Proof/hello-world-7        PBS 计算正确性证明
#   zkFHE-Decryption-Proof/decryption-proof  解密正确性证明
#
# 做的事（幂等，可重复执行）：
#   [1] apt 基础依赖（curl/wget/build-essential/cmake/git/tmux/unzip/libssl-dev/libgomp1）
#   [2] Rust 工具链（rsproxy 镜像；本机 sh.rustup.rs 不可达）+ rust-src/rustfmt 组件
#   [3] cargo crates 镜像（rsproxy-sparse；本机 crates.io 直连不可达）
#   [4] RISC Zero 工具链：rzup + cargo-risczero 1.2.6 + r0vm 1.2.6 + rust 1.85.0
#       —— risc0-build 1.2.6 要求 rustup 里存在名为 "risc0" 的 guest 工具链
#          （rzup 的 rust 组件就是用它注册的，缺了会在 guest 编译时报
#            "The 'risc0' toolchain could not be found / To install the risc0
#             toolchain, use rzup"）
#   [5] 项目代码补丁（3 处，见 task_patch）
#   [6] 自检（工具链 / 路径 / 补丁 / vendor，全通过则打印 OK）
#
# 用法：
#   bash tools/setup_zk_env.sh            # 全流程（已装的步骤自动跳过）
#   bash tools/setup_zk_env.sh --check    # 只做第 [6] 步自检，不改动系统
#   bash tools/setup_zk_env.sh --patch-only   # 只做第 [5] 步项目补丁（tools/env_setup.sh 复用）
#   bash tools/setup_zk_env.sh --force-risc0  # 强制重装 RISC Zero 组件
#   bash tools/setup_zk_env.sh --with-cpp     # 额外装 cpp 工具链（guest 用 C++ 时才需要）
#
# 日志：/tmp/zk_env_setup.log（子步骤 /tmp/zk_env_setup.<name>.log）
# 完成后：bash tools/run_zk_demo.sh all   # dev-mode 跑两个 demo（/tmp/zk1.log、/tmp/zk2.log）
# ============================================================================
exec 3>&1                    # 保留原始 stdout（fd 3），供 --check/--patch-only 把结果打到终端
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
ROOT=${ROOT:-/root/Bisai}
# 版本锚点：两个项目的 Cargo.lock 都解析到 risc0-zkvm 1.2.6；risc0-build 1.2.6 的
# guest 工具链（risc0-build/src/docker.rs 里的 r0.1.85.0）对应 rzup rust 组件 1.85.0
ZK_RISC0_VERSION=${ZK_RISC0_VERSION:-1.2.6}
ZK_RISC0_RUST=${ZK_RISC0_RUST:-1.85.0}

PROBLEMS=()
FAILED=()
stamp(){ echo; echo "################## $* ##################"; date '+%F %T'; }
rc(){ echo "  [exit=$?] $*"; }
note(){ echo "  [!!] $*"; PROBLEMS+=("$*"); }
fail(){ echo "  [FAIL] $*"; FAILED+=("$*"); }

DO_CHECK=0
FORCE_RISC0=0
for a in "$@"; do
  case "$a" in
    --check)        DO_CHECK=1 ;;
    --patch-only)   DO_PATCH_ONLY=1 ;;
    --force-risc0)  FORCE_RISC0=1 ;;
    --with-cpp)     ZK_WITH_CPP=1 ;;
    *) echo "忽略未知参数: $a（可用: --check --patch-only --force-risc0 --with-cpp）" ;;
  esac
done

# 日志重定向（放在参数解析之后，避免单步模式把全流程主日志截断）：
#   全流程 → /tmp/zk_env_setup.log
#   --check / --patch-only → tee 到对应日志并回显终端（fd 3）
if [ "$DO_CHECK" = "1" ]; then
  exec > >(tee /tmp/zk_env_setup.check.log >&3) 2>&1
elif [ "${DO_PATCH_ONLY:-0}" = "1" ]; then
  exec > >(tee /tmp/zk_env_setup.patch.log >&3) 2>&1
else
  exec > /tmp/zk_env_setup.log 2>&1
fi

export PATH="$HOME/.cargo/bin:$HOME/.risc0/bin:$PATH"

# ============================================================================
# 任务函数
# ============================================================================

task_apt(){  # [1] apt 基础依赖（apt 独占锁：必须最先串行完成）
  local need=()
  for b in curl wget cmake gcc g++ make tmux git unzip; do
    command -v "$b" >/dev/null 2>&1 || need+=("$b")
  done
  if [ "${#need[@]}" -eq 0 ]; then
    echo "apt 基础依赖齐全，跳过（缺: 无）"
    return 0
  fi
  echo "缺少: ${need[*]} —— 执行 apt-get update + install"
  apt-get update -o Acquire::Retries=3
  apt-get install -y -o Dpkg::Options::="--force-confold" -o Acquire::Retries=3 \
    curl wget build-essential cmake git pkg-config tmux unzip \
    libssl-dev libgomp1 ca-certificates
}

task_rust(){  # [2a] Rust 工具链（rsproxy：本机不达 sh.rustup.rs）
  if command -v cargo >/dev/null 2>&1; then
    echo "cargo 已存在: $(cargo -V)，跳过安装"
    return 0
  fi
  export RUSTUP_DIST_SERVER=https://rsproxy.cn
  export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
  export RUSTUP_INIT_SKIP_PATH_CHECK=yes
  echo "通过 rsproxy 安装 Rust（stable，minimal profile）..."
  curl --proto '=https' --tlsv1.2 -sSf https://rsproxy.cn/rustup-init.sh | sh -s -- -y \
    --default-toolchain stable --profile minimal
  local r=$?
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
  echo "cargo=$(cargo -V 2>&1)  rustc=$(rustc -V 2>&1)"
  return $r
}

task_rust_src(){  # [2b] 两个项目的 rust-toolchain.toml 都声明了 rustfmt + rust-src
  if ! command -v rustup >/dev/null 2>&1; then
    echo "[WARN] rustup 不存在，跳过组件安装"
    return 1
  fi
  local miss=()
  rustup component list --toolchain stable 2>/dev/null | grep -q '^rust-src (installed)' || miss+=(rust-src)
  rustup component list --toolchain stable 2>/dev/null | grep -q '^rustfmt.* (installed)' || miss+=(rustfmt)
  if [ "${#miss[@]}" -eq 0 ]; then
    echo "rust-src / rustfmt 已安装，跳过"
    return 0
  fi
  echo "安装组件: ${miss[*]}"
  export RUSTUP_DIST_SERVER=https://rsproxy.cn
  export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
  rustup component add "${miss[@]}" --toolchain stable
}

task_cargo_mirror(){  # [3] cargo crates 镜像（本机 crates.io 直连不可达）
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

task_rzup(){  # [4a] rzup（RISC Zero 工具链管理器）
  if command -v rzup >/dev/null 2>&1; then
    echo "rzup 已存在: $(cd / && rzup --version 2>/dev/null | head -1)，跳过安装"
    return 0
  fi
  echo "安装 rzup ..."
  curl -L https://risczero.com/install -o /tmp/rzup_install.sh && bash /tmp/rzup_install.sh || return 1
  export PATH="$HOME/.risc0/bin:$PATH"
  grep -q '.risc0/bin' "$HOME/.bashrc" 2>/dev/null || \
    echo "export PATH=\"\$PATH:$HOME/.risc0/bin\"" >> "$HOME/.bashrc"
}

task_risc0_components(){  # [4b] cargo-risczero / r0vm / rust（guest 工具链 "risc0"）
  command -v rzup >/dev/null 2>&1 || { echo "[WARN] rzup 缺失"; return 1; }
  echo "--- 当前已装组件 ---"; rzup show 2>/dev/null

  # rzup 把每个版本装进独立目录：~/.risc0/extensions/v<ver>-cargo-risczero-<target>/
  # 该目录里同时含 cargo-risczero 与 r0vm 两个可执行文件，用它判断"该版本是否已就位"
  local ext="$HOME/.risc0/extensions/v${ZK_RISC0_VERSION}-cargo-risczero-$(rustc -vV | awk '/host:/{print $2}')"

  # 4b-1 cargo-risczero：host 侧调用 `cargo risczero build` 编 guest，版本必须与 risc0-build 一致
  if [ "$FORCE_RISC0" = "1" ] || [ ! -x "$ext/cargo-risczero" ]; then
    echo "安装 cargo-risczero $ZK_RISC0_VERSION ..."
    rzup install ${FORCE_RISC0:+--force} cargo-risczero "$ZK_RISC0_VERSION" || return 1
  else
    echo "cargo-risczero $ZK_RISC0_VERSION 已安装，跳过"
  fi

  # 4b-2 r0vm：zkVM 服务端，risc0 要求与 risc0-zkvm 同 major.minor，否则 prove() 报 not compatible
  if [ "$FORCE_RISC0" = "1" ] || [ ! -x "$ext/r0vm" ]; then
    echo "安装 r0vm $ZK_RISC0_VERSION ..."
    rzup install ${FORCE_RISC0:+--force} r0vm "$ZK_RISC0_VERSION" || return 1
  else
    echo "r0vm $ZK_RISC0_VERSION 已安装，跳过"
  fi

  # 4b-3 rust：给 rustup 注册名为 "risc0" 的 guest 工具链（risc0-build 1.2.6 硬依赖该名字）
  if [ "$FORCE_RISC0" = "1" ] || ! rustup toolchain list 2>/dev/null | grep -q '^risc0'; then
    echo "安装 risc0 guest Rust 工具链（rust $ZK_RISC0_RUST）..."
    rzup install ${FORCE_RISC0:+--force} rust "$ZK_RISC0_RUST" || return 1
    rustup toolchain list
  else
    echo "risc0 guest 工具链已注册，跳过"
  fi

  # 4b-4 cpp：仅当 guest 用到 C++（或绑 C++ 的 crate）时才需要；两个 demo 的 guest 是纯 Rust，
  #      默认跳过以免白下 ~1GB。需要时加 --with-cpp 或 ZK_WITH_CPP=1
  if [ "${ZK_WITH_CPP:-0}" = "1" ] || [ "$FORCE_RISC0" = "1" ]; then
    if ls -d "$HOME/.risc0/toolchains/cpp-"* >/dev/null 2>&1; then
      echo "cpp 工具链已安装，跳过"
    else
      echo "安装 cpp 工具链 ..."
      rzup install cpp 2024.1.5 || note "cpp 工具链安装失败（如需 C++ guest 再手动 rzup install cpp）"
    fi
  else
    echo "[SKIP] cpp 工具链（两个 demo 的 guest 纯 Rust；需要时 --with-cpp）"
  fi
}


detect_dangling_api(){  # 探测 risc0 guest 工具链的 rustc 里 Layout 悬垂指针方法名（dangling / dangling_ptr）
  local probe=/tmp/zk_dangling_probe.rs
  printf '#![no_std]\n#[allow(unused)]\nfn probe(l: core::alloc::Layout) -> *const u8 { l.dangling_ptr().as_ptr() }\n' > "$probe"
  if rustup run risc0 rustc --crate-type lib --edition 2021 "$probe" -o /tmp/zk_dangling_probe.rlib >/dev/null 2>&1; then
    echo dangling_ptr
  else
    echo dangling
  fi
}

task_patch(){  # [5] 项目代码补丁（与 tools/env_setup.sh 的 task_patch 保持一致，幂等）
  local ZK1_GUEST="$ROOT/ZK-Compuation-Proof/hello-world-7/methods/guest/Cargo.toml"
  local ZK1_HOST="$ROOT/ZK-Compuation-Proof/hello-world-7/host/Cargo.toml"
  local ZK2_GUEST="$ROOT/zkFHE-Decryption-Proof/decryption-proof/methods/guest/Cargo.toml"
  local VENDOR="$ROOT/zkFHE-Decryption-Proof/vendor/embedded-alloc-0.6.0"

  # 5-1 ZK1 guest：原作者把 vendored tfhe-rs 写成了 macOS 绝对路径
  if [ -f "$ZK1_GUEST" ]; then
    sed -i 's#/Users/farhadnouri/Desktop/IEEE_Globecom/tfhe-rs-main/tfhe#../../../tfhe-rs-main/tfhe#' "$ZK1_GUEST"
    grep -n 'tfhe' "$ZK1_GUEST" | sed 's/^/    ZK1 guest: /'
  else
    fail "未找到 $ZK1_GUEST"
  fi

  # 5-2 ZK1 host：原作者 macOS 用 aarch64-unix；x86_64 上 concrete-csprng 会因
  #     特性 generator_aarch64_aes 编译失败（Feature generator_aarch64_aes requires target_arch aarch64）
  if [ -f "$ZK1_HOST" ]; then
    sed -i 's/"aarch64-unix"/"x86_64-unix"/' "$ZK1_HOST"
    grep -n 'tfhe' "$ZK1_HOST" | sed 's/^/    ZK1 host:  /'
  else
    fail "未找到 $ZK1_HOST"
  fi

  # 5-3 ZK2 guest：约 90MB 大密钥输入需要可回收堆（risc0 默认 bump 分配器不回收 → zkVM 内 OOM）；
  #     heap-embedded-alloc 特性依赖 embedded-alloc 0.6.0，而它用的 `Layout::dangling()` 在较新的
  #     rustc 上已改名 `dangling_ptr()`。**改名与否取决于"编译 guest 的那个 rustc"**：
  #       · guest 由 risc0 guest 工具链编译（本脚本装 rust 1.85.0）→ 只有 dangling()（原名）
  #       · host 的 stable 1.98 已是 dangling_ptr()
  #     所以这里先探测 risc0 工具链支持哪个名字，再把 vendor 副本补成对应名字（幂等）。
  if [ -f "$ZK2_GUEST" ]; then
    sed -i "s/features = \['std'\]/features = ['std', 'heap-embedded-alloc']/" "$ZK2_GUEST"
    if [ -d "$VENDOR" ]; then
      local api; api=$(detect_dangling_api)
      echo "  risc0 guest 工具链（$(rustup run risc0 rustc -V 2>/dev/null)）用 Layout::${api}()"
      sed -i "s/\\.dangling()/\\.${api}()/g; s/\\.dangling_ptr()/\\.${api}()/g" \
        "$VENDOR/src/llff.rs" "$VENDOR/src/tlsf.rs"
      if ! grep -q "\.${api}()" "$VENDOR/src/tlsf.rs"; then
        fail "vendor 补丁未生效: $VENDOR/src/tlsf.rs"
      fi
      if ! grep -q '^\[patch.crates-io\]' "$ZK2_GUEST"; then
        printf '\n# embedded-alloc 0.6.0 与本机 rustc 的 Layout::dangling 命名对齐（见 tools/setup_zk_env.sh 5-3）\n[patch.crates-io]\nembedded-alloc = { path = "../../../vendor/embedded-alloc-0.6.0" }\n' >> "$ZK2_GUEST"
      fi
    else
      fail "vendor 补丁目录缺失: $VENDOR（可从 ~/.cargo/registry/src/*/embedded-alloc-0.6.0 复制后按上面规则改名）"
    fi
    grep -nE 'heap-embedded-alloc|patch.crates-io|embedded-alloc =' "$ZK2_GUEST" | sed 's/^/    ZK2 guest: /'
  else
    fail "未找到 $ZK2_GUEST"
  fi

  # 5-4 两个 guest 的 vendored tfhe 源码必须在位（仓库里通常被 .gitignore 忽略）
  for d in "$ROOT/ZK-Compuation-Proof/tfhe-rs-main/tfhe" "$ROOT/zkFHE-Decryption-Proof/tfhe-rs-main/tfhe"; do
    [ -f "$d/Cargo.toml" ] || fail "vendored tfhe 缺失: $d"
  done
}

task_check(){  # [6] 自检（不改动系统）
  local ok=1
  chk(){ # chk <说明> <命令...>
    local desc="$1"; shift
    if "$@" >/dev/null 2>&1; then
      printf '  [OK ] %s\n' "$desc"
    else
      printf '  [!! ] %s\n' "$desc"; ok=0
    fi
  }
  echo "--- 工具链 ---"
  chk "cargo 可用" cargo -V
  chk "rustup 可用" rustup --version
  chk "rust-src 组件已装" bash -c "rustup component list --toolchain stable | grep -q '^rust-src (installed)'"
  chk "rzup 可用" rzup --version
  chk "cargo-risczero 版本 $ZK_RISC0_VERSION" bash -c \
      "cargo risczero --version 2>/dev/null | grep -q '$ZK_RISC0_VERSION'"
  chk "r0vm 与 risc0-zkvm 同 major.minor（$ZK_RISC0_VERSION）" bash -c \
      "r0vm --version 2>/dev/null | grep -q '$ZK_RISC0_VERSION'"
  chk "rustup 里有 risc0 guest 工具链" bash -c "rustup toolchain list | grep -q '^risc0'"
  echo "--- 镜像与目录 ---"
  chk "cargo 镜像 rsproxy 已配置" bash -c "grep -q rsproxy-sparse $HOME/.cargo/config.toml"
  chk "两个项目目录存在" bash -c "[ -d $ROOT/ZK-Compuation-Proof/hello-world-7 ] && [ -d $ROOT/zkFHE-Decryption-Proof/decryption-proof ]"
  chk "vendored tfhe 源码（ZK1）" test -f "$ROOT/ZK-Compuation-Proof/tfhe-rs-main/tfhe/Cargo.toml"
  chk "vendored tfhe 源码（ZK2）" test -f "$ROOT/zkFHE-Decryption-Proof/tfhe-rs-main/tfhe/Cargo.toml"
  echo "--- 项目补丁 ---"
  local api other
  api=$(detect_dangling_api)
  [ "$api" = "dangling" ] && other="dangling_ptr" || other="dangling"
  chk "ZK1 guest 用相对路径 tfhe" bash -c \
      "grep -q '\.\./\.\./\.\./tfhe-rs-main/tfhe' $ROOT/ZK-Compuation-Proof/hello-world-7/methods/guest/Cargo.toml"
  chk "ZK1 host 用 x86_64-unix（非 aarch64-unix）" bash -c \
      "grep -q 'x86_64-unix' $ROOT/ZK-Compuation-Proof/hello-world-7/host/Cargo.toml && ! grep -q 'aarch64-unix' $ROOT/ZK-Compuation-Proof/hello-world-7/host/Cargo.toml"
  chk "ZK2 guest 开启 heap-embedded-alloc" bash -c \
      "grep -q 'heap-embedded-alloc' $ROOT/zkFHE-Decryption-Proof/decryption-proof/methods/guest/Cargo.toml"
  chk "ZK2 guest 有 embedded-alloc vendor patch" bash -c \
      "grep -q '^\[patch.crates-io\]' $ROOT/zkFHE-Decryption-Proof/decryption-proof/methods/guest/Cargo.toml"
  chk "vendor/embedded-alloc 的 Layout 方法名 = guest 工具链的 $api（非 $other）" bash -c \
      "grep -q '\.${api}()' $ROOT/zkFHE-Decryption-Proof/vendor/embedded-alloc-0.6.0/src/tlsf.rs && ! grep -q '\.${other}()' $ROOT/zkFHE-Decryption-Proof/vendor/embedded-alloc-0.6.0/src/tlsf.rs"
  chk "ZK2 guest 的 7 份 env::read 未被误改" bash -c \
      "[ \"\$(grep -c 'env::read();' $ROOT/zkFHE-Decryption-Proof/decryption-proof/methods/guest/src/main.rs)\" = 7 ]"
  echo "--- 资源 ---"
  echo "  mem:  $(free -h | awk '/^Mem:/{print $2" total / "$7" available"}')   cpu: $(nproc) core"
  echo "  disk: $(df -h $ROOT | awk 'NR==2{print $4" available"}')"
  echo "  [提示] ZK2 host 会 println! 打印超大密钥结构体，/tmp/zk2.log 可达数百 MB（实测 312MB），属正常"
  if [ "$ok" = "1" ]; then echo "===== 自检全部通过 ====="; else echo "===== 自检存在失败项（见上 [!!]）====="; fi
  [ "$ok" = "1" ]
}

# ============================================================================
# 主流程
# ============================================================================
stamp "ZK 环境配置开始（ROOT=$ROOT risc0=$ZK_RISC0_VERSION / rust $ZK_RISC0_RUST）"

if [ "$DO_CHECK" = "1" ]; then
  stamp "[6] 自检"
  task_check && exit 0 || exit 1
fi

# --patch-only：只做项目代码补丁（供 tools/env_setup.sh 复用，保持补丁逻辑单一来源）
if [ "${DO_PATCH_ONLY:-0}" = "1" ]; then
  stamp "[5] 项目代码补丁（--patch-only）"
  task_patch
  if [ "${#FAILED[@]}" -gt 0 ]; then
    echo "===== 补丁/文件缺失 ${#FAILED[@]} 项 ====="
    i=1; for p in "${FAILED[@]}"; do echo "  $i. $p"; i=$((i+1)); done
    exit 1
  fi
  exit 0
fi

# [1] apt 基础依赖（串行）
stamp "[1] apt 基础依赖"
task_apt && echo "  [OK ] apt 基础依赖" || note "apt 基础依赖安装失败"

# [2] Rust + 组件
stamp "[2] Rust 工具链 + rust-src/rustfmt"
if task_rust; then
  echo "  [OK ] Rust"
else
  note "Rust 安装失败"
fi
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export PATH="$HOME/.cargo/bin:$HOME/.risc0/bin:$PATH"
if task_rust_src; then echo "  [OK ] rust-src/rustfmt"; else note "rust-src/rustfmt 安装失败"; fi

# [3] cargo crates 镜像（必须在 Rust 之后）
stamp "[3] cargo crates 镜像（rsproxy）"
if task_cargo_mirror; then echo "  [OK ] cargo 镜像"; else note "cargo 镜像配置失败"; fi

# [4] RISC Zero 工具链
stamp "[4] RISC Zero：rzup + cargo-risczero/r0vm $ZK_RISC0_VERSION + rust $ZK_RISC0_RUST"
if task_rzup && task_risc0_components; then
  echo "  [OK ] RISC Zero 工具链"
else
  note "RISC Zero 工具链安装不完整（重跑本脚本或 rzup install 补装）"
fi

# [5] 项目代码补丁
stamp "[5] 项目代码补丁"
task_patch

# [6] 自检
stamp "[6] 自检"
task_check || note "自检存在失败项"

# 汇总
stamp "汇总"
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "===== 补丁/文件缺失 ${#FAILED[@]} 项 ====="
  i=1; for p in "${FAILED[@]}"; do echo "  $i. $p"; i=$((i+1)); done
  echo "（检查代码是否完整上传，例如 $ROOT/ZK-Compuation-Proof、$ROOT/zkFHE-Decryption-Proof）"
fi
if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  echo "===== 本次存在 ${#PROBLEMS[@]} 个问题 ====="
  i=1
  for p in "${PROBLEMS[@]}"; do echo "  $i. $p"; i=$((i+1)); done
  echo "修复后可原样重跑（脚本幂等）: bash $0 $*"
  touch /tmp/zk_env_setup.fail
else
  echo "===== 环境就绪，无遗留问题 ====="
  rm -f /tmp/zk_env_setup.fail
fi
echo "下一步：bash $ROOT/tools/run_zk_demo.sh all   （dev-mode 跑两个 demo）"
touch /tmp/zk_env_setup.done
[ "${#PROBLEMS[@]}" -gt 0 ] && exit 1 || exit 0


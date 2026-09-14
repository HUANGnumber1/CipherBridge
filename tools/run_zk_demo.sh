#!/usr/bin/env bash
# ============================================================================
# run_zk_demo.sh — 运行两个 ZK 验证 demo（RISC Zero · dev-mode）
#
# 用法：
#   bash tools/run_zk_demo.sh computation   # ZK-Compuation-Proof（PBS 计算正确性证明）
#   bash tools/run_zk_demo.sh decryption    # zkFHE-Decryption-Proof（解密正确性证明）
#   bash tools/run_zk_demo.sh all           # 依次跑两个（默认）
#
# 日志：/tmp/zk1.log（computation）、/tmp/zk2.log（decryption）
#       ⚠ decryption 的 host 会 println! 超大密钥结构体，日志可达数百 MB，属正常现象
# 结束码：/tmp/zk1.exitcode、/tmp/zk2.exitcode（0 = 成功）
#
# 期望输出（两个 demo 结尾都是这句）：
#   Hello, world! I generated a proof of guest execution! <LweCiphertext ...> is a public output from journal
# 另有：WARNING: proving in dev mode. This will not generate valid, secure proofs.
#
# 前置（env_setup.sh --risczero 已内置）：
#   rzup install                # cargo-risczero / rust / cpp
#   rzup install r0vm 1.2.6     # 项目用 risc0-zkvm 1.2.x，r0vm 必须同 major.minor
#   rustup component add rust-src --toolchain stable
# ============================================================================
set -uo pipefail

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export PATH="$HOME/.cargo/bin:$HOME/.risc0/bin:$PATH"
ZK_ROOT=${ZK_ROOT:-/root/Bisai}

# dev-mode：只执行 guest 逻辑、不产真实证明（秒级~分钟级）
export RISC0_DEV_MODE=1
export RUST_LOG="${RUST_LOG:-[executor]=info}"

# risc0-zkvm 1.2.x 需要同 major.minor 的 r0vm 服务端（rzup install 默认装的是 3.0.x，会报 not compatible）
R0VM_12=$(ls "$HOME/.risc0/extensions/"v1.2*-cargo-risczero-*/r0vm 2>/dev/null | head -1)
if [ -n "$R0VM_12" ] && [ -x "$R0VM_12" ]; then
  export RISC0_SERVER_PATH="$R0VM_12"
else
  echo "[WARN] 未找到 r0vm 1.2.x —— 请先执行: rzup install r0vm 1.2.6"
fi

run_one(){  # run_one <标签> <项目目录> <日志文件>
  local tag="$1" dir="$2" log="$3" ec
  echo "===== $tag 开始 $(date '+%F %T')  dir=$dir ====="
  ( cd "$dir" && cargo run ) > "$log" 2>&1
  ec=$?
  echo "===== $tag 结束 exit=$ec $(date '+%F %T')  log=$log ====="
  echo "$ec" > "${log%.log}.exitcode"
  if [ "$ec" -eq 0 ]; then
    grep -a 'I generated a proof of guest execution' "$log" | head -1 | cut -c1-160 | sed 's/^/  [OK] /'
  else
    echo "  [!!] 失败，日志尾部："
    tail -n 15 "$log" | cut -c1-200 | sed 's/^/       /'
  fi
  return $ec
}

target="${1:-all}"
case "$target" in
  computation|comp|1)
    run_one computation "$ZK_ROOT/ZK-Compuation-Proof/hello-world-7" /tmp/zk1.log
    rc=$? ;;
  decryption|decrypt|dec|2)
    run_one decryption  "$ZK_ROOT/zkFHE-Decryption-Proof/decryption-proof" /tmp/zk2.log
    rc=$? ;;
  all)
    run_one computation "$ZK_ROOT/ZK-Compuation-Proof/hello-world-7" /tmp/zk1.log; c1=$?
    run_one decryption  "$ZK_ROOT/zkFHE-Decryption-Proof/decryption-proof" /tmp/zk2.log; c2=$?
    rc=0; { [ "$c1" -eq 0 ] && [ "$c2" -eq 0 ]; } || rc=1 ;;
  *)
    echo "用法: bash tools/run_zk_demo.sh [computation|decryption|all]"
    exit 2 ;;
esac

echo "---- 汇总：exit=$rc（0=成功；日志见 /tmp/zk*.log）----"
exit $rc

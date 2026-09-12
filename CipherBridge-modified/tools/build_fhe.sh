#!/usr/bin/env bash
# ============================================================================
# build_fhe.sh — 编译 FHE-API (release)。日志 /tmp/fhe_build.log
# 等待 env_setup 完成（cargo 就绪）后再编译。
# ============================================================================
exec > /tmp/fhe_build.log 2>&1
set -uo pipefail
echo "===== build_fhe start $(date '+%F %T') ====="

# 等待 env_setup 完成
for i in $(seq 1 240); do
  [ -f /tmp/env_setup.done ] && break
  sleep 5
done
if [ ! -f /tmp/env_setup.done ]; then
  echo "[WARN] env_setup.done 未出现，仍尝试编译"
fi

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export PATH="$HOME/.cargo/bin:$PATH"
echo "cargo: $(cargo -V 2>&1)"

cd /root/Bisai/FHE-API || { echo "[FATAL] 找不到 FHE-API"; exit 1; }
echo "--- 编译使用 Cargo.toml tfhe 行 ---"
grep -n 'tfhe' Cargo.toml
echo "--- 开始 cargo build --release ---"
cargo build --release
ec=$?
echo "===== cargo build exit=$ec $(date '+%F %T') ====="
if [ "$ec" -eq 0 ]; then
  ls -la target/release/tfhe-example 2>&1
  touch /tmp/fhe_build.done
fi
exit $ec

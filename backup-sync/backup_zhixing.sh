#!/usr/bin/env bash
# ============================================================================
# backup_zhixing.sh — 智星云实例“工作成果打包”脚本（在云端运行）
#
# 用法：
#   bash /root/backup_zhixing.sh            # 默认：排除大目录
#   bash /root/backup_zhixing.sh --full     # 全量(含 target/node_modules/tfhe-rs-main，体积大)
#
# 会打包：
#   1) /root/Bisai 代码与配置（默认排除 */node_modules、*/target、*/.git、tfhe-rs-main）
#   2) /root/backups/logs/ ：运行日志(fhe_build/fhe_api/chain/web)、tmux 会话、manifest 清单
#      manifest.txt = 各仓库 git status + 最近提交 + deployments.json
#
# 输出：/root/backups/cipherbridge_<时间戳>.tar.gz
#       最新包路径写入 /root/backups/LATEST.txt（供本地 pull_backup.ps1 读取）
#       自动只保留最近 5 份备份
# ============================================================================
set -uo pipefail

ROOT=/root/Bisai
BACKUP_DIR=/root/backups
LOG_DIR="$BACKUP_DIR/logs"
FULL=0

for a in "$@"; do
  case "$a" in
    --full) FULL=1 ;;
    *) echo "忽略未知参数: $a（仅支持 --full）" ;;
  esac
done

STAMP=$(date +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/cipherbridge_${STAMP}.tar.gz"

mkdir -p "$LOG_DIR"
[ -d "$ROOT" ] || { echo; echo "[FATAL] 找不到 $ROOT —— 代码没上传或路径不对"; exit 1; }

# ---------- 1. 收集日志与清单 ----------
echo "===== [1/3] 收集日志与 git/deploy 清单 ====="
cp -f /tmp/fhe_build.log /tmp/fhe_api.log /tmp/chain.log /tmp/web.log "$LOG_DIR/" 2>/dev/null || true
tmux ls > "$LOG_DIR/tmux_sessions.txt" 2>/dev/null || true

{
  echo "backup time: $(date '+%F %T')"
  echo
  for d in FHE-API FHE-Frontend FHE-Protocol ZK-Compuation-Proof zkFHE-Decryption-Proof; do
    if [ -d "$ROOT/$d/.git" ]; then
      echo "===== $d : git status ====="
      git -C "$ROOT/$d" status --short 2>/dev/null | head -80
      echo "===== $d : recent commits ====="
      git -C "$ROOT/$d" --no-pager log --oneline -5 2>/dev/null
      echo
    fi
  done
  echo "===== deployments.json ====="
  cat "$ROOT/FHE-Protocol/deployments.json" 2>/dev/null || echo "(不存在，可能还没部署)"
  echo
  echo "===== 运行中的 tmux 会话 ====="
  cat "$LOG_DIR/tmux_sessions.txt" 2>/dev/null || true
} > "$LOG_DIR/manifest.txt"

# ---------- 2. 打包 ----------
echo "===== [2/3] 打包中 ... ====="
EXC=()
EXC+=(--exclude="*/node_modules")
EXC+=(--exclude="*/target")
EXC+=(--exclude="*/.git")
if [ "$FULL" = "0" ]; then
  EXC+=(--exclude="tfhe-rs-main")
  echo "  模式: 精简(排除 node_modules/target/.git/tfhe-rs-main)  想全量请加 --full"
else
  echo "  模式: 全量(体积可能数 GB，耗时较长)"
fi

if ! tar "${EXC[@]}" -czf "$OUT" -C /root Bisai -C "$BACKUP_DIR" logs 2>/dev/null; then
  echo "[FATAL] tar 打包失败——请检查磁盘空间：df -h /root"
  exit 1
fi

# ---------- 3. 记录与清理 ----------
echo "===== [3/3] 记录 LATEST 并清理旧备份(保留 5 份) ====="
echo "$OUT" > "$BACKUP_DIR/LATEST.txt"
ls -1t "$BACKUP_DIR"/cipherbridge_*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f

SIZE=$(du -h "$OUT" 2>/dev/null | cut -f1)
echo
echo "[OK] 备份完成：$OUT（$SIZE）"
echo "[OK] 大小参考：$(du -sh "$ROOT" 2>/dev/null | cut -f1)（原代码目录）"
echo
echo "下一步（在本地电脑执行，二选一）："
echo "  1) 推荐：powershell -ExecutionPolicy Bypass -File pull_backup.ps1 -HostName <IP> -Port <端口>"
echo "  2) 手动：scp -P <端口> root@<IP>:$OUT  <本地目录>"

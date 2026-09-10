#!/usr/bin/env bash
# Snapshot current setup status into /tmp/status.txt (reliable to read back).
OUT=/tmp/status.txt
{
  echo "===== STATUS $(date '+%F %T') ====="
  echo "--- env_setup stages ---"
  grep -n 'STAGE\|exit=\|MISSING\|已存在\|node=\|cargo=' /tmp/env_setup.log 2>/dev/null | tail -30
  echo "--- env_setup tail ---"
  tail -5 /tmp/env_setup.log 2>/dev/null
  echo "--- env_setup.done ? ---"
  ls -la /tmp/env_setup.done 2>&1
  echo "--- bin checks ---"
  for b in node npm npx cargo rustc tmux cmake curl; do printf '%-8s %s\n' "$b" "$(command -v $b 2>/dev/null || echo MISSING)"; done
  echo "node=$(node -v 2>&1) npm=$(npm -v 2>&1) cargo=$(cargo -V 2>&1)"
  echo "--- build log ---"
  echo "Downloaded lines: $(grep -c 'Downloaded' /tmp/fhe_build.log 2>/dev/null)"
  echo "Compiling  lines: $(grep -c 'Compiling' /tmp/fhe_build.log 2>/dev/null)"
  echo "fhe_build.done: $(ls /tmp/fhe_build.done 2>&1)"
  tail -4 /tmp/fhe_build.log 2>/dev/null || echo "(no build log)"
  echo "--- memory ---"
  free -m | head -2
  echo "--- procs ---"
  pgrep -af 'env_setup|cargo|rustc|npm|node' 2>/dev/null | head
} > "$OUT" 2>&1

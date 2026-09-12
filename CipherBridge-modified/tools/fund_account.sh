#!/usr/bin/env bash
# 给指定地址充值（hardhat 内存链）。用途：前端生成的随机钱包本身没有余额，
# UI 上链写操作（注册/建任务等）会 insufficient funds；用本脚本给该地址发币。
# 用法: bash tools/fund_account.sh <address> [eth]     默认 1000 ETH
set -uo pipefail
ADDR="${1:?usage: fund_account.sh <address> [eth]}"
ETH="${2:-1000}"
HEX=$(python3 -c "print(hex(int(float('$ETH')*10**18)))")
echo "fund $ADDR with $ETH ETH ($HEX)"
curl -s -X POST -H 'Content-Type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"method\":\"hardhat_setBalance\",\"params\":[\"$ADDR\",\"$HEX\"],\"id\":1}" \
  http://127.0.0.1:8545
echo
curl -s -X POST -H 'Content-Type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$ADDR\",\"latest\"],\"id\":1}" \
  http://127.0.0.1:8545
echo

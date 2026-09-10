#!/usr/bin/env bash
# Network reachability probe for the setup endpoints used by CipherBridge.
exec > /tmp/net_test.log 2>&1
echo "===== net test $(date) ====="
probe() {
  local name="$1" url="$2"
  if timeout 12 wget -q -O /dev/null "$url" 2>/dev/null; then
    echo "OK    $name   $url"
  else
    echo "FAIL  $name   $url"
  fi
}
probe "tuna-ubuntu"    https://mirrors.tuna.tsinghua.edu.cn/ubuntu/dists/jammy/Release
probe "npmmirror-reg"  https://registry.npmmirror.com
probe "npmmirror-node" https://npmmirror.com/mirrors/node/v20.18.0/node-v20.18.0-linux-x64.tar.xz
probe "nodesource"     https://deb.nodesource.com/setup_20.x
probe "rsproxy"        https://rsproxy.cn/rustup-init.sh
probe "sh.rustup.rs"   https://sh.rustup.rs
probe "static.crates"  https://static.crates.io/crates/tfhe/tfhe-0.8.7.crate
probe "crates.io-api"  https://crates.io/api/v1/crates/tfhe
probe "github"         https://github.com
probe "github-raw"     https://raw.githubusercontent.com
probe "risczero"       https://risczero.com/install
echo "===== done $(date) ====="

# 两个 ZK 验证项目启动操作文档

> 适用对象：**computation-proof**（ZK-Compuation-Proof）与 **decryption-proof**（zkFHE-Decryption-Proof）两个 RISC Zero 项目的启动操作。
> **前提：运行环境已配置完成**（Rust stable、RISC Zero 工具链 rzup/cargo-risczero、vendored tfhe-rs-main 源码均在位、Linux/macOS/WSL2）。
> 若环境尚未配置，先执行 `bash /root/Bisai/tools/env_setup.sh --risczero` 或参考 `remote-setup/ZHIXINGYUN_GUIDE.md`。

---

## 0. 两个项目一览

| | computation-proof | decryption-proof |
|---|---|---|
| 仓库路径 | `ZK-Compuation-Proof/hello-world-7` | `zkFHE-Decryption-Proof/decryption-proof` |
| 云端绝对路径 | `/root/Bisai/ZK-Compuation-Proof/hello-world-7` | `/root/Bisai/zkFHE-Decryption-Proof/decryption-proof` |
| RISC0 版本 | risc0-zkvm **1.1.3** | risc0-zkvm **1.2.0** |
| 密码学参数 | 玩具级（PolynomialSize=16，×2 查找表） | 真实级（LWE 742 / Poly 2048 / 4bit 消息） |
| 核心逻辑 | zkVM 内执行 **PBS 盲旋转**（blind_rotate_ntt64_assign → extract_lwe_sample），证明“密文计算被正确执行” | zkVM 内用 **大 LWE 密钥解密 PBS 输出** 并断言与明文一致，证明“该密文确解出该值” |
| 运行模式 | 方式 A：dev-mode（秒级） / 方式 B：真实证明（慢、吃内存） | 同左 |

两者结构一致：`host`（宿主，构造输入/跑证明）+ `methods/guest`（RISC-V 无 std 内核）。

---

## 1. 启动前 10 秒自检（环境已配置的前提确认）

```bash
# 1) 工具链
cargo --version        # Rust 在 PATH
rzup --version 2>/dev/null || command -v rzup || echo "rzup 缺失，需先装 RISC Zero"

# 2) 两个项目目录与 vendored tfhe 源码在位
ls -d /root/Bisai/ZK-Compuation-Proof/tfhe-rs-main/tfhe \
        /root/Bisai/zkFHE-Decryption-Proof/tfhe-rs-main/tfhe

# 3) 确认 guest 依赖为相对路径（已修复，不应再是 macOS 绝对路径）
grep 'tfhe' /root/Bisai/ZK-Compuation-Proof/hello-world-7/methods/guest/Cargo.toml
```

全通过即可进入第 2 节。

---

## 2. computation-proof 启动步骤

```bash
cd /root/Bisai/ZK-Compuation-Proof/hello-world-7
```

### 方式 A（推荐）：开发模式，验证逻辑正确

```bash
RISC0_DEV_MODE=1 RUST_LOG="[executor]=info" cargo run
```

- 首次运行：编译 guest（RISC-V 目标）+ host，**约几分钟到十几分钟**；
- dev-mode **不生成真实密码学证明**，只执行 guest 逻辑并输出 journal，适合日常验证；
- 预期输出（结尾）：
  ```text
  Hello, world! I generated a proof of guest execution! <LweCiphertextOwned 输出> is a public output from journal
  ```
- 退出码 0、无 `panicked` 即成功。

### 方式 B：真实证明（慢，内存大）

```bash
RUST_LOG=info cargo run
```

- 生成并本地验证 STARK 证明，**内存建议 16GB+，耗时可能很长**；
- 有 Bonsai 云证明可改用：
  ```bash
  BONSAI_API_KEY="你的key" BONSAI_API_URL="https://api.bonsai.xyz" cargo run
  ```

---

## 3. decryption-proof 启动步骤

```bash
cd /root/Bisai/zkFHE-Decryption-Proof/decryption-proof
```

### 方式 A（推荐）：开发模式

```bash
RISC0_DEV_MODE=1 RUST_LOG="[executor]=info" cargo run
```

- 首次编译**比 computation-proof 更久**（参数更大：LWE 742 / Poly 2048）；
- 逻辑：host 明文乘 2（期望 6）→ 送入 zkVM → guest 解密 PBS 输出并 `assert_eq!` 校验 = 6；
- 预期输出（结尾）：断言通过 + 证明完成消息（同上格式）；
- 退出码 0、无 panic 即成功；若 guest 断言失败会直接 panic（说明加解密闭环出错，排查版本错位，见第 5 节）。

### 方式 B：真实证明（同 computation-proof）

```bash
RUST_LOG=info cargo run
# 或 Bonsai：
# BONSAI_API_KEY="..." BONSAI_API_URL="https://api.bonsai.xyz" cargo run
```

---

## 4. 两个项目一起跑（可选脚本化）

```bash
# 依次：先小参数 computation-proof，再 decryption-proof
cd /root/Bisai/ZK-Compuation-Proof/hello-world-7
RISC0_DEV_MODE=1 cargo run
cd /root/Bisai/zkFHE-Decryption-Proof/decryption-proof
RISC0_DEV_MODE=1 cargo run
```

> 建议用 tmux 挂长任务（真实证明）：
> ```bash
> tmux new -s zk1 "bash -lc 'cd /root/Bisai/ZK-Compuation-Proof/hello-world-7 && RISC0_DEV_MODE=1 cargo run 2>&1 | tee /tmp/zk1.log'"
> tail -f /tmp/zk1.log
> ```

---

## 5. 常见问题排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `error: no such command: risczero` / `rzup: command not found` | RISC Zero 工具链未装 | 环境未满足前提 → 先 `bash /root/Bisai/tools/env_setup.sh --risczero` |
| guest 编译报“找不到 riscv 目标” | riscv 工具链未装全 | `rzup install` 重装 |
| 反序列化失败 / 数值断言不通过 | host(crates.io tfhe 0.8.4) 与 guest(vendored tfhe 0.11) 版本错位 | 统一版本：将 host `Cargo.toml` 的 `tfhe` 改为 `{ path = "../../../tfhe-rs-main/tfhe" }` |
| dev-mode 秒退、无输出 | 环境变量未生效 | 确认 `RISC0_DEV_MODE=1` 前缀书写正确，配合 `RUST_LOG="[executor]=info"` 看统计 |
| `Killed` / OOM | 内存不足 | 关掉主流程三个 tmux（chain/api/web）再跑；或改用 dev-mode |
| 编译卡在 guest 构建 | 网络拉取依赖慢 | 已配 rsproxy/crates 镜像时耐心等待；不要 Ctrl+C 中断首次构建 |

---

## 6. 速查卡

```bash
# computation-proof（dev-mode）
cd /root/Bisai/ZK-Compuation-Proof/hello-world-7 && RISC0_DEV_MODE=1 RUST_LOG="[executor]=info" cargo run

# decryption-proof（dev-mode）
cd /root/Bisai/zkFHE-Decryption-Proof/decryption-proof && RISC0_DEV_MODE=1 RUST_LOG="[executor]=info" cargo run

# 真实证明（两个任一）
RUST_LOG=info cargo run
```

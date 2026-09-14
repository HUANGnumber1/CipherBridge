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

# 4) 确认 host 的 arch 特性是本机架构（x86_64），不是原作者的 aarch64
grep 'tfhe' /root/Bisai/ZK-Compuation-Proof/hello-world-7/host/Cargo.toml   # 应为 x86_64-unix

# 5) rust-src 组件（两个项目的 rust-toolchain.toml 都声明了它）
rustup component list --toolchain stable | grep '^rust-src'                # 应为 rust-src (installed)

# 6) r0vm 服务端版本必须与项目里的 risc0-zkvm 同 major.minor
#    两个项目用的是 risc0-zkvm 1.2.x ⇒ 需要 r0vm 1.2.x（rzup install 默认给的是 3.0.x，会报不兼容）
r0vm --version                                                             # 期望 risc0-r0vm 1.2.x
# 若不是 1.2.x：
rzup install r0vm 1.2.6

# 7) decryption-proof 的 guest 需开启可回收堆 + vendor 补丁（否则 zkVM 内 OOM / 编译失败）
grep 'heap-embedded-alloc' /root/Bisai/zkFHE-Decryption-Proof/decryption-proof/methods/guest/Cargo.toml
ls -d /root/Bisai/zkFHE-Decryption-Proof/vendor/embedded-alloc-0.6.0

# 8) decryption-proof 的 guest 必须按“大输入只读字节即释放、小输入才反序列化”处理输入（7 处 env::read）
#    两份大输入（std_bootstrapping_key ≈48.6MB、fourier_bsk ≈48.6MB）在 guest 内只完整读字节、不物化成结构体；
#    否则输入缓冲 + 结构体内部缓冲（bincode 的 Vec<T> 会容量倍增 32MiB→64MiB）同时驻留，峰值 ≈160MiB > 192MiB 上限
#    （改完后 guest 峰值 ≈96MiB —— 单个输入缓冲级别；详见 docs/WORK_LOG_2026-09-14.md §11）
grep -c 'env::read();' /root/Bisai/zkFHE-Decryption-Proof/decryption-proof/methods/guest/src/main.rs   # 应为 7（务必带 '();'：注释里也有 env::read 字样）
#    修复依据、内存推算与仍待确认项见 docs/WORK_LOG_2026-09-14.md §5–§6、§11
#    （请在远端重跑 bash tools/run_zk_demo.sh decryption 确认 exit=0）

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
- ⚠️ **guest 内存硬上限 192MiB**：risc0 1.2 的 zkVM guest 地址空间上限为 `risc0-zkvm-platform::memory::GUEST_MAX_MEM = SYSTEM.start = 0x0C00_0000`（192MiB），堆从 guest ELF 的 `_end` 顶到该上限；本 demo 的 7 份输入里有两份大工件（都**不参与 guest 内计算**）：`std_bootstrapping_key` ≈6.08M×u64 ≈48.6MB + `fourier_bsk` ≈3.04M×c64 ≈48.6MB。guest 现按「大输入只完整读字节（仍进 input digest）→ 形状校验 → 立即释放；小输入才反序列化」处理，峰值 ≈96MiB；**不要改回**“把两份大输入再反序列化成完整结构体”（`Vec<T>` 会容量倍增 32MiB→64MiB，与输入缓冲同时驻留时峰值 ≈160MiB，必然触发 `memory allocation of 67108864 bytes failed`，详见第 5 节）；
- ⚠ host 内部会 `println!("{:?}")` 打印超大密钥结构体，**日志会涨到数百 MB（312MB 实测）属正常现象**；跑之前确认磁盘充足；
- guest 在 zkVM（r0vm 模拟 RV32）里先完整接收 7 份输入（其中两份 ≈48.6MB 大工件占了绝大部分耗时：risc0 的输入流按 32-bit word 编码，bsk 单份读取实测 ≈38.9 亿 cycle），再做 **解密 + `assert_eq!`**（本 demo 的 PBS 是在 host 侧算好的，guest 不重算），**这段是纯 CPU 计算，需要数分钟**，CPU 会长期 100%；
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

## 4. 两个项目一起跑（推荐：一键脚本）

```bash
# 依次跑两个 demo（dev-mode），日志 /tmp/zk1.log、/tmp/zk2.log，结束码 /tmp/zk1.exitcode、/tmp/zk2.exitcode
bash /root/Bisai/tools/run_zk_demo.sh all

bash /root/Bisai/tools/run_zk_demo.sh computation   # 只跑 computation-proof
bash /root/Bisai/tools/run_zk_demo.sh decryption    # 只跑 decryption-proof
```

> 脚本已自动处理三件事：`RISC0_DEV_MODE=1`、`RUST_LOG="[executor]=info"`、以及
> `RISC0_SERVER_PATH` 指向 r0vm 1.2.x（risc0-zkvm 1.2.x 必须配同 major.minor 的 r0vm）。

等价的手工命令：

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
| host 编译报 `concrete-csprng` 的 `Feature generator_aarch64_aes requires target_arch aarch64, current cfg: x86_64`（exit 101） | host `Cargo.toml` 沿用了原作者的 macOS 特性 `aarch64-unix` | 改成 `x86_64-unix`：`sed -i 's/"aarch64-unix"/"x86_64-unix"/' ZK-Compuation-Proof/hello-world-7/host/Cargo.toml`（`tools/env_setup.sh` 已内置该幂等补丁） |
| `error: component 'rust-src' … not installed` 或首次 `cargo run` 卡在下载 | rust-src 组件缺失（`rust-toolchain.toml` 要求） | `rustup component add rust-src --toolchain stable`（`tools/env_setup.sh` 已内置） |
| 运行时报 `Your installation of the r0vm server is not compatible with your host's risc0-zkvm crate`（exit 101，发生在 `prover.prove()`） | rzup 装的是 r0vm 3.0.x，而项目用 risc0-zkvm 1.2.x；risc0 要求 r0vm 与 risc0-zkvm **同 major.minor** | `rzup install r0vm 1.2.6`；或为单次运行指定 `RISC0_SERVER_PATH=/root/.risc0/extensions/v1.2.6-cargo-risczero-x86_64-unknown-linux-gnu/r0vm`（`tools/env_setup.sh --risczero` 已内置） |
| 运行时 `Guest panicked: Out of memory! You have been using the default bump allocator which does not reclaim memory. Enable the heap-embedded-alloc feature`（decryption-proof，exit 101） | guest 输入里有两份 ≈48.6MB 的大工件（`std_bootstrapping_key`、`fourier_bsk`），risc0 默认 bump 分配器不回收内存，读第二份时占用必然超过 192MiB 上限 | guest `Cargo.toml` 的 risc0-zkvm 加 `'heap-embedded-alloc'`（配合下一条的 vendor 补丁，`tools/env_setup.sh` 已内置） |
| guest 打印 `memory allocation of 67108864 bytes failed`，紧接着 host 报 `panicked at host/src/main.rs:244: called Result::unwrap() on an Err value: Trap: IllegalInstruction(c0001073), pc: 0x...`（exit 101，且 host 内存充足、无 OOM killer 记录） | **guest 内 192MiB 地址空间被打满**（不是宿主内存不足）：旧写法把 7 份输入先全部读成 `Vec<u8>` 常驻，再把两份 ≈48.6MB 的大工件（`std_bootstrapping_key`、`fourier_bsk`）bincode 反序列化成完整结构体：输入缓冲 + 结构体内部缓冲 + `Vec<T>` 反序列化的 64MiB 倍增块同时驻留，峰值 ≈160MiB > 192MiB | ✅ 已修复（2026-09-14）：`methods/guest/src/main.rs` 里两份大输入改为「完整读入字节 → 校验字节数/长度头 → 立即释放、**不物化结构体**」，只有 5 份小输入（`lwe_ciphertext_in_clear` / `cleartext_multiplication_result` / `accumulator` / `pbs_multiplication_ct` / `big_lwe_sk`）仍反序列化，峰值 ≈96MiB（单个输入缓冲级别）；7 份输入仍全部被读入并绑进 input digest，绑定性质不变。**不要改回**“把两份大输入再物化成结构体”。根因定位、内存账与本次修复记录见 `docs/WORK_LOG_2026-09-14.md`。注意：`heap-embedded-alloc` 只是让已分配内存可被回收，**不会**扩大 192MiB 硬上限 |
| 开启 `heap-embedded-alloc` 后 guest 编译报 `no method named dangling found for struct core::alloc::Layout`（embedded-alloc 0.6.0） | 本机 risc0 工具链的 rustc 已把 `Layout::dangling` 改名为 `dangling_ptr`，而 risc0 依赖的 embedded-alloc 0.6.0 仍用旧名 | 用 `zkFHE-Decryption-Proof/vendor/embedded-alloc-0.6.0`（同版本、仅改这 2 处）通过 guest `Cargo.toml` 的 `[patch.crates-io]` 替换 |
| 反序列化失败 / 数值断言不通过（guest 报 `Failed to deserialize <字段名>: ...`） | host 用 crates.io `tfhe 0.8.x`、guest 用 vendored `tfhe 0.11.0`（`tfhe-rs-main`）；core_crypto 实体的 bincode 布局实测兼容（ZK1 就是这套组合且 exit=0），一般不是根因 | 仅当确认错位时才统一版本：把 host 的 `tfhe` 改为 vendored 路径（ZK2：`{ path = "../../tfhe-rs-main/tfhe" }`；ZK1：`{ path = "../../../tfhe-rs-main/tfhe" }`）——注意 host 代码是按 0.8.x API 写的，升到 0.11 需同步调整 PBS/密钥生成调用 |
| dev-mode 秒退、无输出 | 环境变量未生效 | 确认 `RISC0_DEV_MODE=1` 前缀书写正确，配合 `RUST_LOG="[executor]=info"` 看统计 |
| `Killed` / OOM | 内存不足 | 关掉主流程三个 tmux（chain/api/web）再跑；或改用 dev-mode |
| 编译卡在 guest 构建 | 网络拉取依赖慢 | 已配 rsproxy/crates 镜像时耐心等待；不要 Ctrl+C 中断首次构建 |

---

## 6. 速查卡

```bash
# 【推荐】一键脚本（自动 dev-mode + r0vm 1.2.x）
bash /root/Bisai/tools/run_zk_demo.sh all          # 两个都跑
bash /root/Bisai/tools/run_zk_demo.sh computation  # 只跑 PBS 计算正确性
bash /root/Bisai/tools/run_zk_demo.sh decryption   # 只跑解密正确性

# computation-proof（dev-mode）
cd /root/Bisai/ZK-Compuation-Proof/hello-world-7 && RISC0_DEV_MODE=1 RUST_LOG="[executor]=info" cargo run

# decryption-proof（dev-mode）
cd /root/Bisai/zkFHE-Decryption-Proof/decryption-proof && RISC0_DEV_MODE=1 RUST_LOG="[executor]=info" cargo run

# 真实证明（两个任一）
RUST_LOG=info cargo run
```

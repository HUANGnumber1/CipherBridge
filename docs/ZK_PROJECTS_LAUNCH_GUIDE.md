# 两个 ZK 验证项目启动操作文档

> 适用对象：**computation-proof**（ZK-Compuation-Proof）与 **decryption-proof**（zkFHE-Decryption-Proof）两个 RISC Zero 项目的启动操作。
> **前提：运行环境已配置完成**（Rust stable + rust-src、RISC Zero 工具链 rzup/cargo-risczero/r0vm 1.2.6、名为 `risc0` 的 guest 工具链、cargo rsproxy 镜像、vendored tfhe-rs-main 源码均在位、Linux/macOS/WSL2）。
> 环境尚未配置时：**`bash /root/Bisai/tools/setup_zk_env.sh`**（本机一键版，幂等，含自检）；
> 或全项目初始化 `bash /root/Bisai/tools/env_setup.sh --risczero`；更多背景见 `remote-setup/ZHIXINGYUN_GUIDE.md`。

---

## 0. 两个项目一览

| | computation-proof | decryption-proof |
|---|---|---|
| 仓库路径 | `ZK-Compuation-Proof/hello-world-7` | `zkFHE-Decryption-Proof/decryption-proof` |
| 云端绝对路径 | `/root/Bisai/ZK-Compuation-Proof/hello-world-7` | `/root/Bisai/zkFHE-Decryption-Proof/decryption-proof` |
| RISC0 版本 | Cargo.toml 写 `1.1.3`，**lock 实际解析 1.2.6** | Cargo.toml 写 `1.2.0`，**lock 实际解析 1.2.6** |
| RISC0 工具链 | cargo-risczero / r0vm **1.2.6** + guest 工具链 rust **1.85.0**（同一套即可跑两个项目） | 同左 |
| 密码学参数 | 玩具级（PolynomialSize=16，×2 查找表） | 真实级（LWE 742 / Poly 2048 / 4bit 消息） |
| 核心逻辑 | zkVM 内执行 **PBS 盲旋转**（blind_rotate_ntt64_assign → extract_lwe_sample），证明“密文计算被正确执行” | zkVM 内用 **大 LWE 密钥解密 PBS 输出** 并断言与明文一致，证明“该密文确解出该值” |
| 运行模式 | 方式 A：dev-mode（分钟级） / 方式 B：真实证明（很慢、吃内存） | 同左（更慢：两份 ≈48.6MB 大输入要逐字节喂进 zkVM） |
| 环境准备 | `bash tools/setup_zk_env.sh` | 同左 |

两者结构一致：`host`（宿主，构造输入/跑证明）+ `methods/guest`（RISC-V 无 std 内核）。

---

## 1. 启动前 10 秒自检（环境已配置的前提确认）

> 【推荐】一条命令完成自检：`bash /root/Bisai/tools/setup_zk_env.sh --check`
> （它会逐项检查工具链/镜像/目录/补丁，并打印内存与磁盘；全 [OK] 即可进入第 2 节）
> 环境尚未配置时执行：`bash /root/Bisai/tools/setup_zk_env.sh`（幂等，全流程见 `tools/setup_zk_env.sh --help` 注释头）。

手工自检（等价内容，便于排障）：

```bash
# 1) 工具链
cargo --version        # Rust 在 PATH（本机 1.98.1，rsproxy 安装）
rustup component list --toolchain stable | grep '^rust-src'   # 应为 rust-src (installed)
rzup --version         # rzup 0.5.0（装于 ~/.risc0/bin）

# 2) 两个项目目录与 vendored tfhe 源码在位
ls -d /root/Bisai/ZK-Compuation-Proof/tfhe-rs-main/tfhe \
        /root/Bisai/zkFHE-Decryption-Proof/tfhe-rs-main/tfhe

# 3) 确认 guest 依赖为相对路径（已修复，不应再是 macOS 绝对路径）
grep 'tfhe' /root/Bisai/ZK-Compuation-Proof/hello-world-7/methods/guest/Cargo.toml

# 4) 确认 host 的 arch 特性是本机架构（x86_64），不是原作者的 aarch64
grep 'tfhe' /root/Bisai/ZK-Compuation-Proof/hello-world-7/host/Cargo.toml   # 应为 x86_64-unix

# 5) r0vm 服务端 / cargo-risczero 必须与项目里的 risc0-zkvm 同 major.minor
#    两个项目的 Cargo.lock 都解析到 risc0-zkvm 1.2.6 ⇒ 需要 r0vm / cargo-risczero 1.2.6
#    （rzup install 默认给最新 3.x，会报 “not compatible”）
r0vm --version          # 期望 risc0-r0vm 1.2.6
cargo risczero --version # 期望 cargo-risczero 1.2.6
#    若缺失：rzup install cargo-risczero 1.2.6 && rzup install r0vm 1.2.6

# 6) 【关键】guest 编译需要一个名为 risc0 的 rustup 工具链（risc0-build 1.2.6 硬依赖该名字）
#    rzup 的 rust 组件就是用这个名字注册的；1.2.6 对应 rust 1.85.0（见 v1.2.6 release note）
rustup toolchain list   # 期望能看到一行 risc0
rustup run risc0 rustc -V   # 期望 rustc 1.85.0-dev
#    若缺失：rzup install rust 1.85.0
#    缺少它会报：The 'risc0' toolchain could not be found / To install the risc0 toolchain, use rzup

# 7) decryption-proof 的 guest 需开启可回收堆 + vendor 副本（否则 zkVM 内 OOM / 编译失败）
grep 'heap-embedded-alloc' /root/Bisai/zkFHE-Decryption-Proof/decryption-proof/methods/guest/Cargo.toml
ls -d /root/Bisai/zkFHE-Decryption-Proof/vendor/embedded-alloc-0.6.0
#    注意：vendor 里 Layout 悬垂指针的**方法名必须与"编译 guest 的那个 rustc"一致**：
#      · guest 由 risc0 guest 工具链 rust 1.85.0 编译 → 用旧名 dangling()
#      · host 用的 stable 1.98 已改名 dangling_ptr()（别把两者搞混，见第 5 节 FAQ）
grep -n 'dangling' /root/Bisai/zkFHE-Decryption-Proof/vendor/embedded-alloc-0.6.0/src/tlsf.rs
#    tools/setup_zk_env.sh 会用 `rustup run risc0 rustc` 探测后自动校正到正确名字

# 8) decryption-proof 的 guest 必须按“大输入只读字节即释放、小输入才反序列化”处理输入（7 处 env::read）
#    两份大输入（std_bootstrapping_key ≈48.6MB、fourier_bsk ≈48.6MB）在 guest 内只完整读字节、不物化成结构体；
#    否则输入缓冲 + 结构体内部缓冲（bincode 的 Vec<T> 会容量倍增 32MiB→64MiB）同时驻留，峰值 ≈160MiB > 192MiB 上限
#    （改完后 guest 峰值 ≈96MiB —— 单个输入缓冲级别；详见 docs/WORK_LOG_2026-09-14.md §11）
grep -c 'env::read();' /root/Bisai/zkFHE-Decryption-Proof/decryption-proof/methods/guest/src/main.rs   # 应为 7
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
| `error: no such command: risczero` / `rzup: command not found` | RISC Zero 工具链未装 | 环境未满足前提 → 先 `bash /root/Bisai/tools/setup_zk_env.sh`（或全项目初始化 `bash /root/Bisai/tools/env_setup.sh --risczero`） |
| guest 编译报“找不到 riscv 目标” | riscv 工具链未装全 | `rzup install` 重装 |
| host 编译报 `concrete-csprng` 的 `Feature generator_aarch64_aes requires target_arch aarch64, current cfg: x86_64`（exit 101） | host `Cargo.toml` 沿用了原作者的 macOS 特性 `aarch64-unix` | 改成 `x86_64-unix`：`sed -i 's/"aarch64-unix"/"x86_64-unix"/' ZK-Compuation-Proof/hello-world-7/host/Cargo.toml`（`tools/env_setup.sh` 已内置该幂等补丁） |
| `error: component 'rust-src' … not installed` 或首次 `cargo run` 卡在下载 | rust-src 组件缺失（`rust-toolchain.toml` 要求） | `rustup component add rust-src --toolchain stable`（`tools/env_setup.sh` 已内置） |
| 运行时报 `Your installation of the r0vm server is not compatible with your host's risc0-zkvm crate`（exit 101，发生在 `prover.prove()`） | rzup 装的是 r0vm 3.0.x，而项目用 risc0-zkvm 1.2.x；risc0 要求 r0vm 与 risc0-zkvm **同 major.minor** | `rzup install r0vm 1.2.6`；或为单次运行指定 `RISC0_SERVER_PATH=/root/.risc0/extensions/v1.2.6-cargo-risczero-x86_64-unknown-linux-gnu/r0vm`（`tools/env_setup.sh --risczero` 已内置） |
| 运行时 `Guest panicked: Out of memory! You have been using the default bump allocator which does not reclaim memory. Enable the heap-embedded-alloc feature`（decryption-proof，exit 101） | guest 输入里有两份 ≈48.6MB 的大工件（`std_bootstrapping_key`、`fourier_bsk`），risc0 默认 bump 分配器不回收内存，读第二份时占用必然超过 192MiB 上限 | guest `Cargo.toml` 的 risc0-zkvm 加 `'heap-embedded-alloc'`（配合下一条的 vendor 补丁，`tools/env_setup.sh` 已内置） |
| guest 打印 `memory allocation of 67108864 bytes failed`，紧接着 host 报 `panicked at host/src/main.rs:244: called Result::unwrap() on an Err value: Trap: IllegalInstruction(c0001073), pc: 0x...`（exit 101，且 host 内存充足、无 OOM killer 记录） | **guest 内 192MiB 地址空间被打满**（不是宿主内存不足）：旧写法把 7 份输入先全部读成 `Vec<u8>` 常驻，再把两份 ≈48.6MB 的大工件（`std_bootstrapping_key`、`fourier_bsk`）bincode 反序列化成完整结构体：输入缓冲 + 结构体内部缓冲 + `Vec<T>` 反序列化的 64MiB 倍增块同时驻留，峰值 ≈160MiB > 192MiB | ✅ 已修复（2026-09-14）：`methods/guest/src/main.rs` 里两份大输入改为「完整读入字节 → 校验字节数/长度头 → 立即释放、**不物化结构体**」，只有 5 份小输入（`lwe_ciphertext_in_clear` / `cleartext_multiplication_result` / `accumulator` / `pbs_multiplication_ct` / `big_lwe_sk`）仍反序列化，峰值 ≈96MiB（单个输入缓冲级别）；7 份输入仍全部被读入并绑进 input digest，绑定性质不变。**不要改回**“把两份大输入再物化成结构体”。根因定位、内存账与本次修复记录见 `docs/WORK_LOG_2026-09-14.md`。注意：`heap-embedded-alloc` 只是让已分配内存可被回收，**不会**扩大 192MiB 硬上限 |
| guest 编译报 `error: The 'risc0' toolchain could not be found. To install the risc0 toolchain, use rzup.` | risc0-build 1.2.6 通过 `RUSTUP_TOOLCHAIN=risc0` 编译 guest，要求 rustup 里存在名为 **risc0** 的工具链 | `rzup install rust 1.85.0`（rzup 的 rust 组件会以 `risc0` 之名注册到 rustup；`tools/setup_zk_env.sh` 已内置） |
| 开启 `heap-embedded-alloc` 后 guest 编译报 `no method named dangling_ptr found for struct core::alloc::Layout` + `help: there is a method dangling`（embedded-alloc 0.6.0） | **guest 是由 risc0 guest 工具链的 rustc 编译的**，而 rzup rust **1.85.0** 里 `Layout` 的方法名仍是旧名 `dangling()`；本机 host 用的 stable **1.98.1** 才改名 `dangling_ptr()`。vendor 副本被（按 host 的直觉）改成了 `dangling_ptr()`，方向反了 | 用 `tools/setup_zk_env.sh`（它会 `rustup run risc0 rustc` 现场探测再改名，幂等）：<br>`bash tools/setup_zk_env.sh --patch-only`<br>手工等价：`sed -i 's/\.dangling_ptr()/\.dangling()/g' zkFHE-Decryption-Proof/vendor/embedded-alloc-0.6.0/src/{llff,tlsf}.rs`。<br>⚠ 结论随工具链而变：若将来 `rzup install rust` 升级到已改名的版本，名字要跟着变回 `dangling_ptr()`——所以**不要**在文档/脚本里硬编码“必须叫 dangling_ptr” |
| 反序列化失败 / 数值断言不通过（guest 报 `Failed to deserialize <字段名>: ...`） | host 用 crates.io `tfhe 0.8.x`（实测 lock 为 0.8.7）、guest 用 vendored `tfhe 0.11.0`（`tfhe-rs-main`）；core_crypto 实体的 bincode 布局实测兼容（ZK1/ZK2 都是这套组合且 exit=0），一般不是根因 | 仅当确认错位时才统一版本：把 host 的 `tfhe` 改为 vendored 路径（ZK2：`{ path = "../../tfhe-rs-main/tfhe" }`；ZK1：`{ path = "../../../tfhe-rs-main/tfhe" }`）——注意 host 代码是按 0.8.x API 写的，升到 0.11 需同步调整 PBS/密钥生成调用 |
| dev-mode 秒退、无输出 | 环境变量未生效 | 确认 `RISC0_DEV_MODE=1` 前缀书写正确，配合 `RUST_LOG="[executor]=info"` 看统计 |
| `Killed` / OOM | 内存不足 | 关掉主流程三个 tmux（chain/api/web）再跑；或改用 dev-mode |
| 编译卡在 guest 构建 | 网络拉取依赖慢 | 已配 rsproxy/crates 镜像时耐心等待；不要 Ctrl+C 中断首次构建 |

---

## 6. 速查卡

```bash
# 【环境】一键配置 + 自检（幂等；已装的步骤自动跳过）
bash /root/Bisai/tools/setup_zk_env.sh            # 全流程：apt/Rust/RISC Zero 1.2.6/guest 工具链/补丁
bash /root/Bisai/tools/setup_zk_env.sh --check    # 只自检（同时打印 /tmp/zk_env_setup.check.log）
bash /root/Bisai/tools/setup_zk_env.sh --patch-only   # 只做项目补丁（校正 vendor 里 Layout 方法名等）

# 【推荐】一键脚本（自动 dev-mode + r0vm 1.2.x）
bash /root/Bisai/tools/run_zk_demo.sh all          # 两个都跑
bash /root/Bisai/tools/run_zk_demo.sh computation  # 只跑 PBS 计算正确性
bash /root/Bisai/tools/run_zk_demo.sh decryption   # 只跑解密正确性

# computation-proof（dev-mode）—— 首次含 guest 编译约 5 分钟
cd /root/Bisai/ZK-Compuation-Proof/hello-world-7 && RISC0_DEV_MODE=1 RUST_LOG="[executor]=info" cargo run

# decryption-proof（dev-mode）—— guest 要逐字节吃两份 ≈48.6MB 大输入，需十几分钟、CPU 100%，别中断
cd /root/Bisai/zkFHE-Decryption-Proof/decryption-proof && RISC0_DEV_MODE=1 RUST_LOG="[executor]=info" cargo run

# 真实证明（两个任一）
RUST_LOG=info cargo run
```

---

## 7. 本次环境配置与验证记录（2026-09-16，本机 Ubuntu 22.04 · 8 核 · 15GiB）

### 7.1 环境版本（`bash tools/setup_zk_env.sh` 一键装好后）

| 项 | 版本/位置 | 说明 |
|---|---|---|
| OS / 硬件 | Ubuntu 22.04.3 LTS，8 核，15GiB，根分区 145G 可用 | 无 GPU 也可以（dev-mode 走 CPU） |
| curl/wget/build-essential/cmake/git/tmux/unzip/libssl-dev/libgomp1 | apt 安装 | setup 脚本第 [1] 步 |
| Rust（host） | **1.98.1**（`~/.cargo/bin`），含 `rust-src`/`rustfmt` | 经 rsproxy 安装（`sh.rustup.rs` 在本机不可达） |
| cargo 镜像 | `~/.cargo/config.toml` → `sparse+https://rsproxy.cn/index/` | 本机 `crates.io` 直连不可达，必须走镜像 |
| rzup | 0.5.0（`~/.risc0/bin`，已写入 `~/.bashrc` 的 PATH） | `curl -L https://risczero.com/install \| bash` |
| cargo-risczero | **1.2.6**（`~/.risc0/extensions/v1.2.6-cargo-risczero-x86_64-unknown-linux-gnu/`） | 与项目 lock 里的 risc0-zkvm 1.2.6 对齐 |
| r0vm | **1.2.6**（同目录；`~/.cargo/bin/r0vm` 软链） | `run_zk_demo.sh` 会自动把它塞给 `RISC0_SERVER_PATH` |
| risc0 guest 工具链 | rustup 里名为 **`risc0`** 的工具链 = rust **1.85.0-dev** | `rzup install rust 1.85.0`；risc0-build 1.2.6 硬依赖该名字 |
| cpp 工具链 | 未装（`--with-cpp` 可选） | 两个 demo 的 guest 是纯 Rust，不需要 |

### 7.2 实测结果（dev-mode）

```text
bash tools/run_zk_demo.sh all
  computation  开始 16:59:07 → 结束 exit=0 17:04:04   (≈5 分钟，首次含 guest+host 编译)
  decryption   开始 17:10:11 → 结束 exit=0 17:26:33   (≈16.5 分钟，guest 逐字节吃两份 48.6MB 输入)
  /tmp/zk1.exitcode = 0 ；/tmp/zk2.exitcode = 0
```

- computation-proof：`/tmp/zk1.log`（18K）结尾
  `Hello, world! I generated a proof of guest execution! LweCiphertext { ... } is a public output from journal`
- decryption-proof：`/tmp/zk2.log`（298M，host `println!` 打印大密钥属正常），guest 关键日志（cycle 计数）：
  ```text
  R0VM[279]        ZK2: guest start (expecting 7 inputs)
  R0VM[3648007256] ZK2: std_bootstrapping_key transferred OK: 48627776 bytes, leading container length = 6078464
  R0VM[7297771132] ZK2: fourier_bsk transferred OK: 48651512 bytes, leading container length = 2970
  R0VM[7303451913] ZK2: all 7 inputs consumed
  R0VM[7303490220] ZK2: guest decrypted PBS output = 6 (expected 6)      <-- assert_eq! 通过
  ```
  ⇒ “大输入只读字节即释放”的内存改法与 heap-embedded-alloc 组合在 192MiB guest 上限下可跑通；
  两份大输入合计约 73 亿 cycle（≈13 分钟 CPU），是本 demo 的耗时主体。

### 7.3 本次为跑通环境实际改动的文件

| 文件 | 改动 | 原因 |
|---|---|---|
| `tools/setup_zk_env.sh` | **新增**（一键装/自检 ZK 环境） | 固化本次全部环境步骤，可重放、幂等 |
| `zkFHE-Decryption-Proof/vendor/embedded-alloc-0.6.0/src/{llff,tlsf}.rs` | `.dangling_ptr()` → `.dangling()` | guest 由 risc0 工具链 rust 1.85.0 编译，其 `core` 里方法名是 `dangling()`（stable 1.98 才叫 `dangling_ptr()`） |
| `zkFHE-Decryption-Proof/decryption-proof/methods/guest/Cargo.toml` | 仅更新注释（`[patch.crates-io]` 保留） | 说明方法名随“编译 guest 的 rustc”变化 |
| `tools/env_setup.sh` | `task_risczero` 补装 cargo-risczero/r0vm 1.2.6 + rust 1.85.0；`task_patch` 的 ZK2 段委派给 `setup_zk_env.sh --patch-only` | 保持补丁逻辑单一来源，避免硬编码错方向 |
| `docs/ZK_PROJECTS_LAUNCH_GUIDE.md` | 本文件（自检、FAQ、速查卡、本验证记录） | 与实测环境保持一致 |

> 复现命令：`bash tools/setup_zk_env.sh && bash tools/run_zk_demo.sh all`

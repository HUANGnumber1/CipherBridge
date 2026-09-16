# CipherBridge / ZK-FHE 实测数据报告

> 全部数字均为**本机实测**（除明确标注"官方参考"处）。
> 原始 CSV / 日志见同目录：`*.csv`、`logs/`。
> 生成时间：2026-09-16。

---

## 0. 测试环境

| 项 | 值 |
|---|---|
| OS | Ubuntu 22.04.3 LTS（内核 5.x，root 运行） |
| CPU | Intel Xeon E5-2698 v4 @ 2.20GHz，**8 vCPU**（4 核 × 2 超线程，单 socket）；指令集 AVX2 / AES-NI / **无 AVX-512** |
| 内存 | 前段实测 **15 GiB**；20:55 机器重启后扩容为 **23 GiB**（下文 FHE/e2e 数据采集于 15 GiB 时段，ZKP 的证明数据采集于 23 GiB 时段；两者 CPU 核数/型号相同，FHE 峰值 RSS 仅 319~545 MB，内存量不影响 FHE 单次耗时） |
| GPU | **NVIDIA Tesla V100-SXM2-32GB**（Compute Capability **7.0**），驱动 550.127.05 |
| CUDA | Toolkit **12.4**（nvcc 12.4.99） |
| CMake | 系统 3.22.1 不满足 tfhe-cuda-backend 要求；改用 miniconda 安装的 **4.4.3**（`CMAKE=` 指定） |
| Rust（host） | **rustc / cargo 1.98.1**（rsproxy 安装），含 rust-src / rustfmt |
| Rust（RISC Zero guest） | rzup 注册的 `risc0` 工具链 = **rust 1.85.0** |
| FHE 库（服务与基准） | crates.io **tfhe 0.8.7**（features: boolean/shortint/integer/x86_64-unix；GPU 版另加 `gpu`） |
| FHE 库（ZK guest） | vendored **tfhe-rs 0.11.0**（`tfhe-rs-main/`） |
| 零知识框架 | **risc0-zkvm 1.2.6**（两个 ZK 项目 Cargo.lock 均解析到 1.2.6）；cargo-risczero / r0vm **1.2.6** |

### 关键 FHE 参数（`PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS`，FHE-API 实际使用）

```
lwe_dimension      = 834          glwe_dimension  = 1
polynomial_size    = 2048         ciphertext_modulus = 2^64（native）
message_modulus    = 4 (2 bit)     carry_modulus  = 4 (2 bit)
pbs_base_log = 23  pbs_level = 1   ks_base_log = 3  ks_level = 5
max_noise_level    = 5            log2_p_fail = -64.074（2^-64）
encryption_key_choice = Big      数据类型 = FheUint64（64 位整数，32 个 2-bit radix 块）
```

> GPU 侧：开启 `gpu` feature 后 `ConfigBuilder::default()` 使用 **GPU 专用 multibit 参数集**，与 CPU 的 2_2 参数**不同**，因此下文 CPU/GPU 对比**不是同参数对比**，仅作量级与结论性对照。

---

## 1. FHE 各环节耗时（CPU，服务同参数，进程内实测）

原始数据：`fhe_cpu_stages.csv`、`fhe_ops_detail.csv`

| 环节 | 实测 | 口径 |
|---|---|---|
| **密钥生成** `generate_keys` | **1392.3 ms** | 含参数编译；CPU 300% |
| 公钥压缩 `CompressedCompactPublicKey::new` | 2.4 ms | |
| **服务端密钥压缩** `CompressedServerKey::new` | **1060.1 ms** | CPU 355% |
| 服务端密钥解压+装载 `decompress()+set_server_key` | **197.7 / 200.6 ms** | ⚠ 服务端**每次** `/compute`、`/decrypt` 都重复执行 |
| **单条数据加密**（压缩密文+序列化） | **5.27 ms**（p50 5.23 / p95 5.79，n=200） | `CompressedFheUint64::try_encrypt` + bincode |
| 单条加密（非压缩 `FheUint64::encrypt`） | 5.25 ms | 免解压，可直接参与计算 |
| 反序列化 | 0.003 ms | |
| **解压 `decompress()`** | **5.60 ms** | 压缩态 → 可计算态 |
| **解密 `decrypt()`** | **0.089 ms** | 已解压密文 → 明文（**真正的解密运算**） |
| **服务端 `/decrypt` 口径** = 反序列化+解压+解密 | **5.30 ms** | 与 HTTP 实测一致 |
| 压缩 `compress()` | 17.42 ms | 计算后密文 → 压缩态 |
| **同态加法** `FheUint64 + FheUint64` | **681 ~ 688 ms** | 含进位 PBS，**性能瓶颈** |
| 同态加法（密文 + 明文标量） | 624.1 ms | |

### 多条密文求和时间（`fhe_cpu_sum.csv`）

| 密文条数 n | 总耗时 | 其中加法累计 | 每次加法 |
|---|---|---|---|
| 10 | 6349.5 ms | 6297.1 ms | ~700 ms |
| 100 | 69 821.9 ms | 69 309.2 ms | ~700 ms |
| 1000 | **673 842.2 ms（11.2 min）** | 668 773.5 ms | ~669 ms |

> 结论：**求和耗时几乎完全由同态加法决定（~0.67 s/次）**，反序列化 0.003 ms、解压 5 ms 属可忽略项。

### 密钥/密文体积（`fhe_cpu_sizes.csv`）

| 项 | 字节 | base64 后 |
|---|---|---|
| 压缩公钥（供前端用） | 16 524 B | **22 032 B**（与 SETUP_LOG 记载一致） |
| 压缩服务端密钥 | 27 410 659 B（26.1 MB） | 36 547 548 B |
| 客户端密钥 | 23 254 B | 31 008 B |
| `CompressedFheUint64`（单条加密结果） | **2 964 B** | 3 952 B |
| `FheUint64`（解压态） | 526 736 B | 702 316 B |
| 计算后结果（压缩态） | 21 525 B | 28 700 B |

---

## 2. FHE GPU（V100）实测 vs CPU

原始数据：`gpu_bench.csv`、`logs/gpu_run.log`、`logs/gpu_util.csv`（**均为本机自测**）

| 环节 | CPU（2_2 参数） | **GPU（V100，GPU 专用参数）** | 说明 |
|---|---|---|---|
| 密钥生成 | 1392.3 ms | 2363.5 ms | |
| 服务端密钥压缩 | 1060.1 ms | 1655.5 ms | |
| 服务端密钥装载 | 197.7 ms（decompress） | **620.5 ms**（`decompress_to_gpu`，含 H2D） | |
| 单条加密（客户端，CPU 侧） | 5.27 ms | 5.25 ms | 加密在客户端 CPU 完成，密文同为 2964 B |
| 单条解密（含解压） | 5.30 ms | 5.82 ms | 同上 |
| **同态加法** | **681 ms** | **72.90 ms** | **≈ 9.3× 加速** |
| 10 条密文求和 | 6349.5 ms | 655.1 ms | ≈ 9.7× |
| 100 条密文求和 | 69 822 ms | 7174.5 ms | ≈ 9.7× |
| 进程峰值 RSS | 319 MB | 724.6 MB | |

**GPU 确实被使用的证据**（`logs/gpu_util.csv`，1 s 采样）：
```
99 %, 43 %, 616 MiB
99 %, 44 %, 648 MiB
99 %, 45 %, 584 MiB     ← GPU 利用率峰值 99%，显存占用 552~648 MiB
```
（19 个采样中 11 个非 0；基准前后各为 0%。采样覆盖 `decompress_to_gpu` + 同态加法段。）

> ⚠ **口径声明**：CPU 与 GPU 使用**不同的参数集**（GPU 版是 multibit GPU 参数），因此上表是"各自默认配置下的实测"，**不是同参数对比**。若计划书要写"加速比"，须同时注明参数差异。
> ⚠ 官方 GPU 参考数据（vendored tfhe-rs 文档 `docs/getting_started/benchmarks/gpu_benchmarks.md`）是 **H100 × 1/× 2、参数 `PARAM_GPU_MULTI_BIT_MESSAGE_2_CARRY_2_GROUP_3_KS_PBS`**，与本机 V100 不可直接比较，报告引用时必须标注为"官方参考"。

---

## 3. ZKP 实测（RISC Zero，dev-mode 与真实证明）

原始数据：`logs/zk1_real.log`、`logs/zk2_bench_lines.txt`

| 指标 | ZK1 · computation-proof（PBS 盲旋转电路） | ZK2 · decryption-proof（解密正确性电路） |
|---|---|---|
| guest 参数 | 玩具级（PolynomialSize=16） | 真实级（LWE 742 / Poly 2048 / 4-bit） |
| 循环数 `total_cycles` | **2 097 152**（2.10 M） | **8 203 010 048**（8.20 G） |
| `user_cycles` | 1 441 422 | 7 304 025 337 |
| **dev-mode 端到端耗时** | **347.9 ms** | **801 779.3 ms（13 m 22 s）** |
| **真实证明 proving time** | **422 510.1 ms（7 m 02 s）** | **未完成 —— 本机不可行**（见下） |
| **receipt 体积** | dev 529 B / **真实 560 492 B（547 KB）** | **33 041 B**（dev） |
| journal 体积 | 164 B | 16 420 B |
| **verification time** | dev 3.598 ms / **真实 146.329 ms** | **3.751 ms**（dev） |
| 运行结果 | exit 0，journal 输出 LweCiphertext | exit 0，guest 断言 `解密结果 6 == 期望 6` |
| 证明正确性 | `receipt.verify(id)` 通过 | `receipt.verify(id)` 通过 |

**ZK2 真实证明为何不可行**：guest 需在 zkVM 内完整读入两份 ≈48.6 MB 大工件（`std_bootstrapping_key`、`fourier_bsk`），仅"读输入"就消耗 **8.2 G cycles**；dev-mode（只执行、不产证明）已耗时 13.4 min。真实 STARK 证明在本机 8 核上按该 cycle 规模推算需数十小时以上，故未执行，本报告只给 dev-mode 数据并明确标注。
ZK1 因为电路是玩具级参数，2.1 M cycles，**真实证明 7 分钟可完成**，因此 ZKP 的 proving/verification/receipt 三项真实数据以 ZK1 为准。

> 备注：`RISC0_DEV_MODE=1` 的目标输出为
> `Hello, world! I generated a proof of guest execution! <LweCiphertext …> is a public output from journal`，
> 两个项目均已复现（ZK2 含 312 MB host 日志，属正常现象，已在文档中说明）。

---

## 4. 「中小微企业信贷风控」端到端实测

业务链路：**企业数据加密 → 多项指标同态聚合 → 结果解密（→ ZKP 验证）**
原始数据：`e2e_stages.csv`、`e2e_scale.csv`、`e2e_add.csv`

### 4.1 阶段耗时（M = 100 家小微企业 × K = 6 项指标）

| 阶段 | wall | CPU | CPU% | 说明 |
|---|---|---|---|---|
| T0 密钥生成（含服务端密钥压缩+装载） | **2 711.7 ms** | 9 340 ms | 344% | 一次性 |
| T1 企业数据加密 | **3 120.3 ms** | 3 120 ms | 100% | 600 条密文（5.2 ms/条） |
| T2b 全池跨企业同态求和 | **414 191.1 ms（6 m 54 s）** | 2 665 420 ms | 644% | 6 项指标 × 99 次 = **594 次同态加法** |
| T3 结果解密 | **894.8 ms** | 6 940 ms | 776% | 解压+解密 6 项聚合结果 |
| **FHE 链路合计（不含 T0）** | **418 206.2 ms（6 m 58 s）** | | | |
| **FHE 链路合计（含 T0）** | **420 917.9 ms（7 m 01 s）** | | | |
| 端到端进程峰值 RSS | 318.8 MB | | | |

校验：解密结果与明文期望值**逐项一致**（`[check] 端到端 加密→聚合→解密 结果正确: true`）。

### 4.2 含 ZKP 阶段的完整链路（M = 20，`--full 1 --zk 1`）

业务链路：**企业数据加密 → 单企业多指标聚合 → 全池跨企业聚合 → 结果解密 → ZKP 生成与验证**
原始数据：`e2e_zk/e2e_stages.csv`、`logs/e2e_zk.log`（**本机自测，一次完整跑通，exit=0**）

| 阶段 | wall | CPU | CPU% | 说明 |
|---|---|---|---|---|
| T0 密钥生成（含服务端密钥压缩+装载） | 2 579.4 ms | 8 960 ms | 347% | 一次性 |
| **T1 企业数据加密** | **638.6 ms** | 640 ms | 100% | 20 家 × 6 指标 = 120 条密文 |
| **T2a 单企业多指标同态聚合** | **76 617.6 ms** | 458 800 ms | 599% | 100 次同态加法 |
| **T2b 全池跨企业同态求和** | **79 500.3 ms** | 509 760 ms | 641% | 114 次同态加法 |
| **T2c 综合风险分跨企业求和** | **15 868.0 ms** | 106 130 ms | 669% | 19 次同态加法 |
| **T3 结果解密** | **1 437.9 ms** | 8 290 ms | 577% | 解压+解密 7 个聚合结果 |
| **T4 ZKP 生成与验证** | **806 175.0 ms（13 m 26 s）** | — | — | ZK 解密正确性证明流程，`exit=0` |
| **端到端合计（不含 T0）** | **980 237.3 ms ≈ 16 m 20 s** | | | |
| **端到端合计（含 T0）** | **982 816.7 ms ≈ 16 m 23 s** | | | |
| 进程峰值 RSS | 319.3 MB | | | |

占比：**FHE 聚合（T2a+T2b+T2c）占 17.5%，ZKP 占 82.2%**，加密/解密合计不到 0.3%。
同轮 `[add]` 复测：单次同态加法 667.9 ms。

> 规模说明：M=20 是本轮"含 ZKP"联调的规模上限 —— 因为 ZK2 的 dev-mode 证明本身就要 13.4 min，
> 若把 M 提到 100，T2b 会从 79 s 涨到 414 s，端到端总时长将超过 30 min。M=100 的纯 FHE 链路见 4.1。

---

## 5. 规模 / 压力 / 并发测试

### 5.1 加密侧规模扫描（`e2e_scale.csv`）

| 企业数 M | 密文数 | 加密耗时 | 吞吐 | 明文密文总大小 | 峰值 RSS | 结果校验 |
|---|---|---|---|---|---|---|
| 10 | 60 | 284.1 ms | 211.2 ct/s | 0.2 MB | 318.8 MB | ✅ |
| 100 | 600 | 3 075.8 ms | 195.1 ct/s | 1.7 MB | 318.8 MB | ✅ |
| 1000 | 6 000 | 30 296.2 ms | 198.0 ct/s | 17.0 MB | 318.8 MB | ✅ |
| **5000** | **30 000** | **153 883.6 ms** | **195.0 ct/s** | **84.8 MB** | 318.8 MB | ✅ |

- 加密吞吐稳定在 **~195 ct/s（5.1 ms/条）**，线性扩展，无衰减；
- 峰值 RSS 恒定 **318.8 MB**（与规模无关，说明密文被逐条释放，**不存在内存泄漏**）；
- **当前系统的真实瓶颈不是内存/规模，而是同态加法 0.67 s/次的吞吐上限**。

### 5.2 HTTP 端到端 + 并发压测（真实服务 `:3000`）

原始数据：`http_bench.csv`、`logs/http_bench.log`

| 接口 | 并发 | 耗时 | 吞吐 | p50 | p95 | p99 |
|---|---|---|---|---|---|---|
| `POST /generate_keys` | 1 | 2 719.4 ms | — | — | — | — |
| `POST /encrypt` ×100 | 1 | 675 ms | 148.1 req/s | 6.5 ms | 7.4 ms | — |
| `POST /encrypt` ×100 | 8 | 107 ms | **931.2 req/s** | 7.7 ms | 10.6 ms | — |
| `POST /encrypt` ×100 | 16 | 102 ms | **981.4 req/s** | 12.8 ms | 21.7 ms | — |
| `POST /compute`（100 密文整批） | 1 | **69 639.5 ms** | — | — | — | — |
| `POST /compute`（分片 2×50） | 1 | 68 030 ms | — | 33 774 ms/片 | 34 253 ms/片 | — |
| `POST /compute`（二次合并 2 片） | 1 | 1 208.5 ms | — | — | — | — |
| `POST /decrypt` | 1 | **343.3 ms** | — | — | — | — |
| **解密结果校验** | | 结果 5050 = 期望 5050 | **一致 ✅** | | | |

请求体：100 条密文的 `/compute` 请求体仅 **0.38 MB**（`RequestBodyLimitLayer` 上限 10 MB ⇒ 单请求最多约 **2500 条密文**）。

### 5.3 内存 / CPU 占用

| 观测对象 | 数值 |
|---|---|
| FHE-API 服务进程 RSS（持有 26.1 MB 服务端密钥 + 600 密文） | **501 MB**（513 004 kB，`ps` 实测） |
| FHE-API 服务 CPU（`/compute` 期间） | **502%**（8 核中约 5 核满载） |
| bench_fhe 进程峰值 RSS | 319.2 MB |
| bench_ops 进程峰值 RSS | 544.9 MB |
| bench_e2e 进程峰值 RSS | 318.8 MB |
| GPU 版进程峰值 RSS | 724.6 MB |
| GPU 显存占用 | **552 ~ 648 MiB** |

---

## 6. 关于计划书里的「CPU 8.77 s / GPU 8.50 s」

**结论：这两个数字在当前工作区内无法溯源。**

- 对 `docs/`、`SETUP_LOG.md`、`tools/`、`FHE-API/`、`FHE-Frontend/`、`FHE-Protocol/` 及两个 ZK 项目做全文检索 `8.77` / `8.50`，**除 tfhe-rs 源码里 `tfhe-fft` 的浮点测试常量（如 `8.779981890745457`）外无任何命中**，没有对应的测试代码、日志或 CSV。
- 因此**无法说明它是"完整业务实测"还是估算/引用**。从数量级看也不像：
  - 本机实测单次 **64 位同态加法 = 0.681 s（CPU）/ 0.0729 s（GPU）**；
  - 单条加密 5.27 ms、单条解密 0.089 ms；
  - ZK1 真实证明 422.5 s、ZK2 dev-mode 801.8 s。
  - 8.77 s / 8.50 s 若指"某一个完整任务"，需要计划书原文才能确认其构成（可能是"某次端到端调用"或"某个中间版本"的数据）。
- 若计划书要引用官方数据，唯一在仓库内可查的官方 benchmark 是 vendored tfhe-rs 的 `docs/getting_started/benchmarks/{cpu,gpu}_benchmarks.md`，其中 GPU 数据来自 **H100**，与本次 V100 环境不同 —— 计划书中必须**分开标注"官方参考"与"本机自测"**。

---

## 7. 结论与建议

1. **FHE 环节可放心写进计划书的实测值**：keygen 1.39 s、单条加密 5.27 ms、单次同态加法 0.68 s（CPU）/ 0.073 s（V100 GPU）、单条解密 0.089 ms（不含解压）、服务端密钥装载 0.20 s。
2. **系统瓶颈非常明确：`/compute` 里的同态加法**。100 家 × 6 指标 = 594 次加法要 6.9 min；HTTP 单请求 100 密文要 69.6 s。加密侧反而很快（~195 ct/s，并发下 981 req/s）。
3. **两个可立刻落地的优化点**：
   - `/compute`、`/decrypt` 每次都 `CompressedServerKey::decompress()` + `set_server_key()`（≈200 ms），应做缓存；
   - 聚合改为 **GPU（V100 快 9.3×）** 或改用更小的整数位宽（如 FheUint16/Uint32，块数由 32 降到 8/16）以成比例降低加法成本。
4. **ZKP**：ZK1 电路可在 7 分钟内完成真实证明（receipt 547 KB，验证 146 ms）；ZK2 的真实级参数需先解决 guest 内 48.6 MB×2 大工件的输入成本（8.2 G cycles），否则真实证明在本机不可行，只能交付 dev-mode 数据。
5. 稳定规模：加密 30 000 条密文（84.8 MB）无异常、内存恒定 319 MB；受限项是**时间**（同态加法吞吐 ≈1.5 次/s）而非内存。

---

## 附：证据文件清单

| 文件 | 内容 |
|---|---|
| `fhe_cpu_stages.csv` | CPU 各阶段耗时/CPU%/峰值 RSS |
| `fhe_ops_detail.csv` | 细粒度算子（加密/解压/解密/加法拆分） |
| `fhe_cpu_sum.csv` | 多条密文求和（n=10/100/1000） |
| `fhe_cpu_sizes.csv` | 密钥与密文体积 |
| `gpu_bench.csv` | V100 各项耗时 |
| `e2e_stages.csv` / `e2e_scale.csv` / `e2e_add.csv` | 端到端阶段耗时 / 规模扫描 / 加法吞吐（M=100，纯 FHE） |
| `e2e_zk/e2e_stages.csv` | **含 ZKP 阶段的端到端分阶段耗时（M=20，T0~T4）** |
| `http_bench.csv` | HTTP 端到端与并发延迟 |
| `logs/gpu_run.log`、`logs/gpu_util.csv` | GPU 运行输出与显存/利用率采样 |
| `logs/zk1_real.log` | ZK1 真实证明（含 `ZK_BENCH` 埋点行） |
| `logs/zk2_bench_lines.txt` | ZK2 dev-mode 埋点行 |
| `logs/fhe_api.log`、`logs/e2e_zk.log`、`logs/http_bench.log`、`logs/bench_ops.log` | 各次运行的完整终端日志 |

### 本次为采集数据新增/改动的文件

| 文件 | 说明 |
|---|---|
| `FHE-API/src/bin/bench_fhe.rs`（新增） | FHE 各环节基准（keygen/加密/求和/解密 + 体积 + 规模扫描） |
| `FHE-API/src/bin/bench_e2e.rs`（新增） | 信贷风控端到端模拟（T0~T4 分阶段计时 + CPU%/RSS + 规模扫描 + `--zk` 联调） |
| `FHE-API/src/bin/bench_ops.rs`（新增） | 细粒度算子基准（解压 / 解密 / 压缩 / 加法拆分） |
| `tools/bench_concurrent.py`（新增） | HTTP 端到端 + 并发压测（纯标准库） |
| `bench-gpu/`（新增 crate） | TFHE-rs GPU(CUDA) 后端基准；`Cargo.toml` 开启 `gpu` feature |
| `ZK-Compuation-Proof/hello-world-7/host/src/main.rs` | **仅新增埋点**（计时 + `ZK_BENCH(...)` 一行 JSON），不改原有逻辑 |
| `zkFHE-Decryption-Proof/decryption-proof/host/src/main.rs` | 同上 |

> ZK 两个项目的**业务逻辑未改动**（guest 代码、参数、输入顺序均保持原样），
> 只增加了 proving 计时、receipt 体积、verify 计时的打印。

### 构建期踩到并已解决的问题（供复现参考）

1. `tfhe-cuda-backend 0.4.1` 要求 **CMake ≥ 3.24**，Ubuntu 22.04 自带 3.22.1 → 用 miniconda 安装 4.4.3，并以 `CMAKE=/home/vipuser/miniconda3/bin/cmake` 构建。
2. 首次 CUDA 构建时 `programmable_bootstrap_classic.cu.o` 产出 **0 字节**（nvcc 静默失败），导致链接报
   `undefined symbol: cuda_programmable_bootstrap_lwe_ciphertext_vector_64`。
   处理：删除 0 字节目标文件后单独 `cmake --build . --target tfhe_cuda_backend -j1` 重编（成功，2.2 MB），
   再把新 `libtfhe_cuda_backend.a` 同步并删除旧 `rlib` 让 cargo 重新链接。
3. 需要 `libclang`（`apt-get install libclang-dev`，LLVM 14）。
4. 长时间后台任务请用 `tmux`；本次曾因机器重启（内存 15GiB → 23GiB）导致 `/tmp` 被清空、后台任务全部丢失一次。

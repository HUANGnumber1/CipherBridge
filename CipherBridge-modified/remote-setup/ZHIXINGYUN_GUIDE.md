# 智星云（AI Galaxy）远程开发 CipherBridge —— 逐步操作指南

> 目标：把「链节点 + FHE-API + 前端」全部跑在一台智星云 Ubuntu 实例上，
> 在你本地浏览器通过 **SSH 隧道 / 平台端口映射** 访问前端，完成远程开发。
> 适用：本仓库 5 个子项目（FHE-API、FHE-Protocol、FHE-Frontend、两个 ZK demo）。
> **本地端（你的电脑）**：Windows + **Trae（TraeCode）** + 系统自带 OpenSSH 客户端。
> Node/Rust 等重型开发环境**全部装在云端实例**，你本地不需要安装任何 Node/Rust。

---

## 第 0 步：选型建议（买实例之前看）

| 项目 | 建议 |
|---|---|
| 系统镜像 | **Ubuntu 20.04 或 22.04**（有 CUDA 驱动的版本即可；镜像自带 Python/CUDA 无所谓） |
| 内存 | **≥ 32GB**（TFHE 全量编译吃内存，16GB 偏紧） |
| 磁盘 | 系统盘外再挂数据盘，**总空间 ≥ 100GB**（Cargo target + node_modules + risc0 都很大） |
| GPU | 若只跑主流程：选最便宜的 GPU 机即可（`gpu` feature 可去掉）；若想出 RISC Zero 真证明或 tfhe GPU 加速：选 4090/A100 等 |
| 网络 | 需要能访问 github / crates.io / npm（国内环境建议先配置镜像，见第 3 步） |

> 主流程对 GPU **没有硬性要求**。智星云若按 GPU 套餐售卖，选入门款即可；若平台提供 CPU 套餐且你不需要跑 ZK，可优先 CPU 大内存套餐。

---

## ⚡ 快速通道：两个现成脚本（建议直接用）

工作区已备好两个自动脚本，连上云主机后可以少敲很多命令：

| 脚本 | 职责 | 说明 |
|---|---|---|
| `setup_zhixing.sh` | 一次性初始化：系统依赖 / Node20 / Rust / crates镜像 / 代码3处补丁 | 幂等可重跑；可选 `--mirror --npm --build --risczero` |
| `resume_zhixing.sh` | 起服务：链 → 部署 → 回填地址 → FHE-API → 前端 | 续跑/一键启动用 |

**基本用法**
```bash
# 本地传脚本（脚本在 E:\workspace\Bisai\remote-setup 目录，已转 LF，无需再 sed）
cd E:\workspace\Bisai\remote-setup
scp -P <SSH端口> setup_zhixing.sh resume_zhixing.sh root@<公网IP>:/root/
# 云端初始化（大陆环境推荐组合）
bash /root/setup_zhixing.sh --mirror --npm --build
# 云端一键起服务
bash /root/resume_zhixing.sh
```

**出错通知约定（两个脚本统一遵守）**
- 关键步骤失败 → 打印 `[FATAL] 原因 + 修复建议`，立即停止，退出码非 0；
- 可选步骤失败 → 打印 `[!!] 警告` 并记录，继续执行；
- 脚本结束时会汇总打印“本次存在 N 个问题/全部通过”，并按需提示“修复后重跑（幂等）”。
所以**看到 `[FATAL]` 或结尾的问题清单时，先按提示处理再继续**，不要直接跳过。

| 可选参数 | 作用 |
|---|---|
| `--mirror` | 换清华 apt 源 |
| `--npm` | 安装链/前端依赖 |
| `--build` | tmux 后台编译 FHE-API |
| `--risczero` | 安装 RISC Zero（跑 ZK 才需要） |

---

## 第 1 步：注册 / 租用实例

1. 浏览器打开智星云官网 `gpu.ai-galaxy.com`（或 `ai-galaxy.com`），注册并登录，完成实名认证与充值。
2. 控制台进入**【算力市场】/【GPU云服务器】**，按第 0 步选实例（地域、GPU 型号、内存大小）。
3. 在“镜像”处选择 **Ubuntu 20.04/22.04**；有“数据盘容量”选项就拉到 100GB+。
4. 选择租用时长/计费方式后**【创建/租用/开机】**，等待状态变为“运行中”。

---

## 第 2 步：用 Trae 连接实例（本地端配置）

**先明确分工**：云端实例负责“装环境 + 编译 + 跑服务”；你本地的 **Trae 只负责远程改代码 + 开集成终端执行命令**；浏览器只用来打开页面（见第 9 步）。所以本地端最小要求只有：Trae、Windows 自带 OpenSSH、一个浏览器。

1. 在智星云【实例列表/实例详情】页记下 **SSH 登录信息**：公网 IP、SSH 端口、用户名（一般 `root`）、密码。

2. （必做，排障用）本机 PowerShell 先验证 SSH 能通：
   ```powershell
   ssh -p <SSH端口> root@<公网IP>        # 例: ssh -p 55234 root@1.2.3.4
   ```
   输入密码能进终端即成功（`Ctrl+D` 退出）。以后日常操作不用开这个窗口。

3. 在 `C:\Users\<你的用户名>\.ssh\` 下新建/编辑 **`config`**（无扩展名），写入主机别名：
   ```text
   Host zhixing
       HostName <公网IP>
       Port <SSH端口>
       User root
   ```
   > 若没有 `.ssh` 目录：`mkdir ~\.ssh` 或在第 2 步成功 ssh 后会自动生成。

4. 打开 **Trae** 连接远程主机（Trae 官方支持 **“SSH / WSL 远程开发”**，入口随版本略有差异，以官方文档为准：`docs.trae.cn` → 开发环境 → “SSH / WSL 远程开发”）。常见两种方式：
   - **方式一（内置远程）**：Trae 左侧/底部找“远程”入口，或命令面板（`Ctrl+Shift+P`）执行 **“SSH: 连接到主机 / Connect to Host”** → 选择 `zhixing` → 首次输入密码（可勾选记住）→ 平台选 **Linux**。
   - **方式二（扩展）**：Trae 兼容 VSCode 生态，可在插件市场安装微软 **Remote - SSH** 扩展，然后 `Ctrl+Shift+P` → `Remote-SSH: Connect to Host` → `zhixing`（复用上面的 config，无需额外配置）。
5. 连接成功后：**打开文件夹 → 输入 `/root/Bisai`** → 确认。此时你就能像本地一样编辑代码，并打开 Trae 集成终端执行第 3~10 步的所有命令。
6. 备选方案：若 Trae 远程始终连不上，可退而求其次——用平台“网页终端 / JupyterLab”执行命令 + 本地 PowerShell 的 `scp` 传文件（见第 4 步），功能等价，只是少了 IDE 便利。

---

## 第 3 步：系统初始化（在实例终端内执行）

```bash
# 3.1 换国内 apt 源（可选但推荐，加快安装）
# Ubuntu 22.04 示例：使用清华源
sudo sed -i 's@//.*archive.ubuntu.com@//mirrors.tuna.tsinghua.edu.cn@g; s@//security.ubuntu.com@//mirrors.tuna.tsinghua.edu.cn@g' /etc/apt/sources.list
sudo apt update

# 3.2 基础编译依赖
sudo apt install -y build-essential cmake git curl pkg-config tmux unzip \
                    libssl-dev libgomp1 ca-certificates

# 3.3 确认 GPU/驱动（不影响主流程，仅确认）
nvidia-smi
```

```bash
# 3.4 安装 Node.js 20（NodeSource）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v && npm -v
```

```bash
# 3.5 安装 Rust（走 rsproxy 国内镜像，速度快）
export RUSTUP_DIST_SERVER=https://rsproxy.cn
export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
curl --proto '=https' --tlsv1.2 -sSf https://rsproxy.cn/rustup-init.sh | sh -s -- -y
source "$HOME/.cargo/env"
rustc -V && cargo -V
```

```bash
# 3.6 配置 crates.io 镜像（大幅加快 cargo 拉依赖）
mkdir -p ~/.cargo
cat >> ~/.cargo/config.toml <<'EOF'
[source.crates-io]
replace-with = "rsproxy-sparse"

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"

[net]
git-fetch-with-cli = true
EOF
```

```bash
# 3.7 （可选）安装 RISC Zero：仅当你要跑两个 ZK demo 才需要
curl -L https://risczero.com/install | bash
source "$HOME/.bashrc"
rzup install      # 若 GitHub 下载慢，可换 rzup 国内镜像或用 dev-mode 继续
```

> 说明：FHE-API 项目的 `.cargo/config.toml` 里设了 `rustc-wrapper = "sccache"`。
> 不装 sccache 就编译会失败。**演示起见建议直接注释该行**（第 5 步里有命令），
> 或 `cargo install sccache` 安装它（耗时较长）。

---

## 第 4 步：把代码弄到云端

仓库里含 vendored 大源码 `tfhe-rs-main`。**先确认它是否被 git 跟踪**：

```bash
# 在你本机（E:\workspace\Bisai 下）执行
git -C zkFHE-Decryption-Proof ls-files tfhe-rs-main | head -3
# 有输出 = 被跟踪，直接 git clone 即可；
# 无输出 = 未跟踪，必须整目录上传，否则 ZK 编译缺依赖。
```

**方式 A：整目录打包上传（最稳妥，含所有 vendored 源码）**

在本地 Windows PowerShell：
```powershell
cd E:\workspace
tar -czf Bisai.tar.gz Bisai            # Win10/11 自带 tar
scp -P <SSH端口> Bisai.tar.gz root@<公网IP>:/root/
```
在云端解压：
```bash
cd /root && tar -xzf Bisai.tar.gz && ls Bisai
# 期望看到: FHE-API FHE-Frontend FHE-Protocol ZK-Compuation-Proof zkFHE-Decryption-Proof
```

**方式 B：git clone（前提：仓库与 tfhe-rs-main 都已 push 到 github）**
```bash
cd /root
git clone https://github.com/JupiterXiaoxiaoYu/FHE-API.git
git clone https://github.com/JupiterXiaoxiaoYu/fhe-frontend.git   # 以你的实际仓库名为准
# FHE-Protocol / 两个 ZK 仓库同理
```

---

## 第 5 步：云端改 3 处代码配置

```bash
cd /root/Bisai

# 5.1 注释掉 FHE-API 的 sccache wrapper（若你不想装 sccache）
sed -i 's/^rustc-wrapper.*/#&/' FHE-API/.cargo/config.toml

# 5.2 去掉 FHE-API 的 GPU feature（云端没有 CUDA 工具链时必做）
sed -i 's/"integer", "x86_64-unix", "gpu"/"integer", "x86_64-unix"/' FHE-API/Cargo.toml
grep -n 'features' FHE-API/Cargo.toml    # 确认改后内容

# 5.3 修复 ZK-Compuation-Proof 的硬编码绝对路径（原作者 macOS 路径）
sed -i 's#/Users/farhadnouri/Desktop/IEEE_Globecom/tfhe-rs-main/tfhe#../../../tfhe-rs-main/tfhe#' \
  ZK-Compuation-Proof/hello-world-7/methods/guest/Cargo.toml
grep -n 'tfhe' ZK-Compuation-Proof/hello-world-7/methods/guest/Cargo.toml
```

> 另建议：zkFHE-Decryption-Proof 的 host 依赖 crates.io tfhe 0.8.4 而 guest 用本地 0.11.0，跑 ZK 前把 host 也指向本地 `../../tfhe-rs-main/tfhe`（与 `tfhe-fft` 一致）以避免版本错位。

---

## 第 6 步：起链 + 部署合约（FHE-Protocol）

```bash
cd /root/Bisai/FHE-Protocol
npm install

# 6.1 起本地链（放入 tmux，别关）
tmux new -s chain -d 'npx hardhat node'
sleep 8 && tail -20 <(tmux pipe-pane -t chain -O) 2>/dev/null   # 看到 RPC listening 即可
# 或直接前台跑一次确认：npx hardhat node

# 6.2 部署 5 个合约到 localhost:8545
tmux new -s deploy -d 'npx hardhat run scripts/deploy.js --network localhost'
sleep 20
cat deployments.json     # 记下 5 个地址
```

> 若 `deployments.json` 为空/失败，说明链没起来或端口被占：
> `ss -lntp | grep 8545`，必要时 `tmux kill-session -t chain` 重启。

---

## 第 7 步：编译并启动 FHE-API

```bash
cd /root/Bisai/FHE-API
# 首次编译 TFHE 全量依赖，非常久（30~60 分钟+），放 tmux 里跑：
tmux new -s build -d 'cargo build --release'
tmux attach -t build        # 想看进度就 attach，Ctrl+B D 退出
# 编译完成后启动服务（绑定 0.0.0.0:3000，代码写死该地址）
tmux new -s api -d 'cargo run --release'
sleep 3 && ss -lntp | grep 3000
# 快速自测（会打印一串密钥，确认返回 JSON 即可）
curl -s -X POST http://127.0.0.1:3000/generate_keys -H 'Content-Type: application/json' \
  -d '{"public_key":"0x9fE7E37F1C1E1A3C4D5E6F708192A3B4C5D6E7F8"}'
```

---

## 第 8 步：改前端合约地址并启动前端

```bash
cd /root/Bisai/FHE-Frontend
# 8.1 把第 6 步 deployments.json 的 5 个地址填进 src/config/contracts.ts
nano src/config/contracts.ts

# 8.2 安装依赖并启动（--host 0.0.0.0 使 vite 对外可达；5173 为默认端口）
npm install
tmux new -s web -d 'npm run dev -- --host 0.0.0.0'
sleep 5 && ss -lntp | grep 5173
```

> 前端 vite 已在配置里把 `/service`→`localhost:3000`、`/api`→`127.0.0.1:8545` 代理到**实例本机**。
> 所以你的浏览器**只需要访问 5173 一个端口**即可用全栈，无需把 3000/8545 暴露到公网。

---

## 第 9 步：从你本地电脑访问前端（二选一）

**方式 A：SSH 隧道（推荐，最稳，无需在控制台开端口）**
在你本地 Windows PowerShell 执行：
```powershell
ssh -N -L 5173:127.0.0.1:5173 -p <SSH端口> root@<公网IP>
```
保持这个窗口别关，然后浏览器打开：
```
http://localhost:5173
```
浏览器→5173→(vite 代理)→实例内 3000/8545，全程走加密隧道，无需暴露公网端口。
> 隧道命令在你**本地 PowerShell** 里运行即可（不依赖 Trae）；Trae/浏览器关掉不影响已跑在云端的服务，重新开隧道即可恢复访问。

**方式 B：平台端口映射/安全组放行**
若智星云控制台支持“开放端口 / 端口映射 / 防火墙”，放行 **TCP 5173**（也可把 3000、8545 一并放行便于调试），然后直接访问 `http://<公网IP>:5173`。
> 注意此时 vite 已用 `--host 0.0.0.0` 启动；若只开隧道，127.0.0.1 绑定就够。

**验证全栈**
1. 打开 `http://localhost:5173`，进入 Client Portal → 生成钱包 → Generate FHE Keys（应返回成功）。
2. 银行侧注册后，`Data Encryption` 页尝试加密并 Upload to Chain。
3. 走一遍“建任务 → 银行处理 → 客户端解密/发布”主流程（参考 `CipherBridge_API_MANUAL.md` 第 10 节）。

---

## 第 10 步（可选）：跑 ZK 两个演示

```bash
# zkFHE-Decryption-Proof（相对路径已可用；host 建议先按第 5 步提示统一 tfhe 版本）
cd /root/Bisai/zkFHE-Decryption-Proof/decryption-proof
RISC0_DEV_MODE=1 RUST_LOG=info cargo run      # dev-mode：快，只执行不产证明

# ZK-Compuation-Proof（先确认第 5.3 步已把绝对路径改对）
cd /root/Bisai/ZK-Compuation-Proof/hello-world-7
RISC0_DEV_MODE=1 cargo run
```

> 出**真证明**（去掉 `RISC0_DEV_MODE=1`）对 CPU/内存要求极高，建议用 4090/A100 + CUDA prover，或走 Bonsai 云证明；日常开发一律 dev-mode。

---

## 第 11 步：日常远程开发工作流

| 想做什么 | 操作 |
|---|---|
| 改代码 | 用 **Trae** 远程连接（第 2 步）打开 `/root/Bisai` |
| 看 FHE-API 日志 | `tmux attach -t api`（Ctrl+B D 退出） |
| 重启链/重部署 | `tmux kill-session -t chain` → 重跑第 6 步（链上状态会清零） |
| 重启服务 | 逐个 `tmux kill-session -t api/web` 后重跑对应启动命令 |
| 关机省钱 | 智星云一般“关机不收费或低收费”，离开前到控制台关机；**注意无状态服务会丢** |
| 上传新改动 | `scp -P <port> file root@ip:/root/Bisai/...` 或直接 git push/pull |

---

## 第 12 步：注意事项（务必读）

1. **无状态**：`hardhat node` 是内存链，`FHE-API` 密钥只存内存。**实例重启/关机后**：
   - 链要重新 `npx hardhat node` + `scripts/deploy.js`；
   - 前端 `contracts.ts` 里的地址要用新部署结果再改一遍；
   - 用户在 FHE-API 的密钥要重新 `generate_keys`。
2. **数据盘 vs 系统盘**：把代码放 `/root`（或平台给的数据盘目录），避免系统盘重置丢失。
3. **国内网络**：GitHub/crates/npm 慢是常态——crates 用 rsproxy（第 3.6 步），npm 可加 `npm config set registry https://registry.npmmirror.com`。
4. **不要对公网开 8545/3000**：链与 FHE-API 无鉴权，只经 vite 代理/隧道访问即可；需要调试再临时放行 3000。
5. **GPU feature**：若第 5.2 步去掉了 `gpu`，本地跑演示完全够用；以后要 GPU 加速需在实例里装 CUDA Toolkit（`nvcc -V` 确认）再改回 feature。
6. **两份地址不一致**：`ContractTest.js` 与前端 `contracts.ts` 不是同一套部署——以你云上 `deployments.json` 为准。
7. 智星云控制台的具体按钮名（如“镜像/数据盘/端口映射”）以官网实际界面为准；流程本质与上述一致。

## 附 A：下次如何“从上次的断点”继续运行（重点）

**先记住这套项目里 3 个“无状态”点**（决定你能恢复到哪一步）：
1. `hardhat node` 是**内存链**——进程一停/实例重启，链上合约与数据清零，地址会变；
2. FHE-API 的密钥**只存内存**——进程重启后所有用户都要重新 `/generate_keys`；
3. 前端 `contracts.ts` **写死合约地址**——重新部署后必须回填新地址。
但好消息是：**代码、cargo 编译缓存(target)、node_modules 都还在**（前提：智星云关机/重启后数据盘保留），所以**不需要重新编译**，续跑很快。

### 场景 1：只是本地断开（Trae 关了 / 电脑休眠 / 断网），实例没停 ✅ 零恢复成本
云端 tmux 里的进程都还活着，什么都不丢：
1. 重新打开 Trae → SSH 连接 `zhixing` → 打开 `/root/Bisai`；
2. 本地 PowerShell 重新开隧道：`ssh -N -L 5173:127.0.0.1:5173 -p <端口> root@<IP>`；
3. 想看日志：`tmux attach -t chain` / `-t api` / `-t web`（Ctrl+B D 退出）。
> 这是最省事的用法：**平时别停实例**（有“关机不计费/无卡模式”之类就开着），下次直接连。

### 场景 2：实例被关机/重启过（数据盘保留，进程全没了）✅ 用续跑脚本
恢复程度 = “代码与依赖就绪”，链和密钥需要重建。把 `remote-setup` 目录的 `resume_zhixing.sh` 传到云端一键执行：
```bash
# 本地执行（脚本位于 E:\workspace\Bisai\remote-setup）
scp -P <SSH端口> E:\workspace\Bisai\remote-setup\resume_zhixing.sh root@<公网IP>:/root/
# 云端执行：
chmod +x /root/resume_zhixing.sh
bash /root/resume_zhixing.sh
```
脚本会自动完成：重启 `hardhat node` → 重新部署 5 个合约 → 用 `deployments.json` 回填前端 `contracts.ts` → 启动 FHE-API → 启动前端，并打印“还要做”的清单（主要是**用户重新 generate_keys**）。
> 说明：cargo 有缓存，二次启动 FHE-API 只需几秒~几分钟，不会像首次那样编 30~60 分钟。

### 场景 3（进阶，可选）：想连“合约地址、FHE 密钥、链上数据”都原样恢复
项目当前设计做不到，需要做两处“落盘”小改造才能实现真正断点：
- **A. FHE-API 密钥落盘**：改 `FHE-API/src`，在 `generate_keys` 时把 (client_key, server_key, 压缩公钥) bincode 写盘；启动时若文件存在则直接 load，而不是重新生成。改造后**用户不用每次重新生成密钥**。
- **B. 内存链换成可落盘链**：用 Foundry 的 `anvil` 替代 `hardhat node`：`anvil --chain-id 20200 --state /root/anvil-state.json`（下次 `--load-state` 恢复）。因为链状态持久化，**合约地址永远不变**，也就不需要回填 `contracts.ts`。
这两处改造都不大；需要的话我可以直接把 A/B 的补丁代码和配套脚本写好给你。

### 恢复前快速自查（判断属于哪种场景）
```bash
# 云端执行：tmux 会话还在 = 场景1
tmux ls
# 看磁盘/代码是否保留（能列出版本文件 = 不用重新上传/编译）
ls /root/Bisai/FHE-API/target 2>/dev/null && echo "cargo缓存还在"
ls -d /root/Bisai/FHE-Frontend/node_modules 2>/dev/null && echo "npm依赖还在"
```
如果连 `/root/Bisai` 都没有（数据盘被重置/换实例），那只能回到第 4 步整包上传重来一遍。

---

*配套文档（在 `E:\workspace\Bisai\docs` 目录）：`CipherBridge_API_MANUAL.md`（API 手册）、`CipherBridge_ARCHITECTURE.md`（架构图）。*



# CipherBridge 环境配置与构建工作记录

> 自动生成：由 AI 助手按 `docs/` + `remote-setup/ZHIXINGYUN_GUIDE.md` 执行并记录。
> 机器：Ubuntu 22.04.3 LTS，15GiB RAM，根分区 196G（可用 148G）。以 root 运行。
> 相关文档：`docs/后端输出查看指南.md`（如何触发并查看后端 FHE-API 的输出）。

## 0. 初始环境探查（基线）

| 项 | 状态 |
|---|---|
| OS | Ubuntu 22.04.3 LTS |
| RAM | 15GiB（低于文档建议的 32GB，TFHE 编译可能偏慢） |
| 磁盘 | / 196G，可用 148G |
| node / npm | ❌ 未安装 |
| rust / cargo | ❌ 未安装 |
| tmux | ❌ 未安装 |
| curl | ❌ 未安装（setup 脚本依赖它，需先装） |
| python3 | ✅ /home/vipuser/miniconda3/bin/python3 |
| FHE-API/target | ❌ 无 cargo 缓存（首次需全量编译 30~60min） |
| FHE-Protocol/node_modules | ❌ 未安装 |
| FHE-Frontend/node_modules | ❌ 未安装 |
| Bisai_local.tar.gz | ⚠ 29 字节、已损坏/截断（无法用作代码备份） |

## 1. 执行步骤记录

（按时间顺序追加）

### [16:17] 问题1：apt 源 security.ubuntu.com 返回 404
- 现象：`apt-get install` 拉取 curl/wget/libssl-dev/ca-certificates 时报 `404 Not Found`（security.ubuntu.com）。
- 处理：按文档第 3.1 步换清华源；`/etc/apt/sources.list` 重写为 `mirrors.tuna.tsinghua.edu.cn`（原文件备份为 `sources.list.bak`）。
- 结果：apt update/install 恢复正常。

### [16:19] 环境基线 & 网络探测
- 结论：node/npm/rust/cargo/tmux/curl 均未安装；无 cargo target 缓存、无 node_modules。
- 网络：tuna、npmmirror、rsproxy、github、static.crates.io、risczero 均可达；`sh.rustup.rs` 不可达 → 改用 rsproxy 安装 Rust；`crates.io/api` 不可达 → 用 rsproxy 镜像 + static.crates.io 正常。
- 说明：本机 15GiB RAM 低于文档建议 32GB，TFHE 全量编译存在 OOM 风险。

### [16:20→16:27] 环境初始化完成（tools/env_setup.sh，exit 全 0）
- STAGE1 apt 基础依赖 ✅（换清华源后正常）
- STAGE2 Node.js v20.18.0 + npm 10.8.2 ✅（npmmirror 二进制包安装到 /usr/local）
- STAGE3 Rust 1.98.1 ✅（rsproxy 安装）
- STAGE4 cargo crates 镜像（rsproxy）✅
- STAGE5 代码补丁 ✅：注释 sccache wrapper；去掉 tfhe gpu feature；修复 ZK guest 绝对路径
- STAGE6 npm 依赖：FHE-Protocol ✅、FHE-Frontend ✅
- 备注/问题2：本机仅 8 核 15GiB RAM（文档建议 32GB）。将 `FHE-API/.cargo/config.toml` 的 `jobs` 由 8 降到 4，避免 TFHE 编译 OOM。

### [16:31] FHE-API 编译成功 ✅
- `Finished \`release\` profile [optimized] target(s) in 3m 45s`，`cargo build exit=0`。
- 产物：`/root/Bisai/FHE-API/target/release/tfhe-example`（7.27MB）。
- 仅 12 条 warning（unused imports/vars），无 error。
- 说明：4 jobs、rsproxy 镜像下 TFHE 全量 release 编译仅约 3m45s。

### [16:32] 问题3：合约部署失败 —— 部署账户余额为 0（insufficient funds）
- 现象：`npx hardhat run scripts/deploy.js --network localhost` 报
  `Sender doesn't have enough funds to send tx ... sender's balance is: 0`，部署账户 `0x6E860137C4788A54072BF819fB161606359c42FC`。
- 根因：`FHE-Protocol/hardhat.config.js` 的 `localhost.accounts` 指定了一把私钥（仅用于签名），
  但 `npx hardhat node` 只为其**默认助记词**账户发币，二者不是同一账户 ⇒ 该账户 0 余额。
- 修复：在 `tools/start_services.sh` 启动链后新增步骤 2.5，用 `hardhat_setBalance`
  给部署账户充值 10000 ETH（`0x21e19e0c9bab2400000`）。属于运行期修复，不改动项目源码语义。
- 验证：`eth_getBalance` 返回 `0x21e19e0c9bab2400000`。✅

### [16:34] 重新启动全套服务 —— 全部成功 ✅
- 链 `hardhat node` :8545 ✅
- 部署账户充值 10000 ETH ✅
- 5 个合约部署成功 ✅
- 前端 `contracts.ts` 回填成功 ✅
- FHE-API :3000 就绪 ✅（cargo 缓存命中，秒级启动）
- 前端 :5173 就绪 ✅
- tmux 会话：`chain` / `api` / `web`

### [16:35] 验证结果
1) **FHE-API 冒烟测试**（`tools/smoke_test.py`）✅ PASSED
   generate_keys(fhe_public_key len=22032) → get_public_key → encrypt(10,20,30) → compute → decrypt
   解密结果 **60 = 期望 10+20+30**。
2) **链上合约测试**（`tools/chain_test.js`）✅ PASSED
   `isAdmin(deployer)=true`；`addBank` 后 `isBank=true`；`registerUser` 后 `user.isActive=true`、`accessControl.isRegisteredUser=true`。
3) **前端 vite 代理链路**✅
   `POST /service/generate_keys` → 返回密钥；`POST /api (eth_blockNumber)` → `0x7`；前端首页 HTTP 200。

---

## 2. 当前运行状态与访问方式

| 组件 | 监听 | 说明 |
|---|---|---|
| 前端 | `0.0.0.0:5173` | 浏览器访问：本地开隧道 `ssh -N -L 5173:127.0.0.1:5173 -p <端口> root@<IP>` 后打开 `http://localhost:5173` |
| FHE-API | `0.0.0.0:3000` | 前端经 vite 代理 `/service` 访问 |
| 链 | `127.0.0.1:8545` | 前端经 vite 代理 `/api` 访问 |
| tmux | `chain` / `api` / `web` | 查看日志：`tmux attach -t api`（Ctrl+B 再 D 退出） |

日志：`/tmp/fhe_build.log`、`/tmp/start_services.log`、`/tmp/fhe_api.log`、`/tmp/chain.log`、`/tmp/web.log`。

## 3. 本次部署的合约地址（内存链，重启即变）
见 `FHE-Protocol/deployments.json` 与 `FHE-Frontend/src/config/contracts.ts`（已回填一致）：
AccessControl `0x9d4e764dfa453238BeCCe857973682bc810DE7ff`、UserRegistry `0x2F07acb5F4812E6Ea3170278eD9F3F96c3E7a70F`、
BankRegistry `0xD4ae737D77C4f8A507e3fF04dAf43ab74fad5E80`、DataStorage `0x0CD1358A923533263E3a6F0822508aB419a7ef6C`、
TaskManagement `0xAcCC396A91A82d179a430225A2AFA32b5F355b0D`。

## 4. 已知注意事项（使用前须知）
1. **钱包充值**：前端 Client/Bank 钱包在浏览器内随机生成（0 余额），而前端用该钱包私钥**直接签名上链交易**
   （`new ethers.Wallet(wallet.privateKey, provider)`）⇒ UI 上的上链写操作（注册用户/银行、建任务等）会 `insufficient funds`。
   - 解决 A：`bash tools/fund_account.sh <地址>` 给该地址充值；
   - 解决 B：前端钱包弹窗用「Import Private Key」导入 hardhat 默认账户私钥
     `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`（地址 `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`，自带 10000 ETH）。
2. **无状态**：hardhat node 是内存链、FHE-API 密钥仅存内存。实例重启后重跑 `bash tools/start_services.sh`（会自动重部署 + 回填地址）。
3. **文档已知 bug 未修改**：BankRegistry.registerBank 死分支、数据类型双命名等，见 `docs/CipherBridge_API_MANUAL.md` 第 12 节。
4. **`Bisai_local.tar.gz` 已损坏**（29 字节），本次未使用；备份请参考 `backup-sync/`。

## 5. 可复用脚本（`tools/`）
| 脚本 | 作用 |
|---|---|
| `env_setup.sh` | 一次性环境初始化（apt / Node20 / Rust / 镜像 / 3 处补丁 / npm 依赖） |
| `build_fhe.sh` | 编译 FHE-API（release） |
| `start_services.sh` | 一键起全套服务（含部署账户充值修复） |
| `patch-addr.js` | 用 deployments.json 回填前端合约地址 |
| `smoke_test.py` | FHE-API 端到端冒烟测试 |
| `chain_test.js` | 链上合约交互测试 |
| `fund_account.sh` | 给任意地址充值 |
| `poll.sh` | 状态快照 → /tmp/status.txt |

## 6. 结论
项目已在**本机完整构建并成功运行**：环境（Node20 + Rust1.98 + 依赖镜像）就绪，FHE-API 编译通过，
链+5 合约部署成功，前端与 FHE-API 均已启动，端到端（含代理链路）验证通过。
总耗时约 15 分钟（16:20 开始 → 16:35 全部跑通），未触及 40 分钟阈值。



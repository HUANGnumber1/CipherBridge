# 修改记录（Change Log）

- **记录日期**：2026-09-10
- **范围**：`E:\workspace\Bisai`（CipherBridge 演示项目：FHE-API / FHE-Protocol / FHE-Frontend / 2 个 ZK demo）
- **本次目的**：修复“**只能加密、无法创建任务（createTask 失败）**”的链上权限缺陷，并记录同期新增的运维脚本与文档。

---

## 1. 问题背景与根因

**症状**
- FHE-API 加密（`POST /encrypt`）正常；
- 银行上传数据 / 客户端创建任务失败，典型报错：
  - `Invalid bank address`（createTask）
  - `Only bank can store data`（storeUserData）

**根因**：`BankRegistryContract.registerBank` 的**死分支 bug**——
`require(!banks[msg.sender].isActive)` 已保证后续 `if (!isActive)` 恒为真，导致真正的登记逻辑写在 `else` 里**永远不可达**：

- `banks[msg.sender]` 结构体从未写入（`id=0`、`publicKey=空`）；
- `nextBankId` 从不递增；
- **`accessControl.addBank()` 从不执行 → AccessControl 中该地址不是 bank**；
- `BankRegistered` 事件从不发出（前端取 `bankId` 会得到 undefined）。

由于 `createTask` 要求 `accessControl.isBank(bankAddress) == true`、`storeUserData` 要求 `isBank(msg.sender) == true`，故必然失败。

---

## 2. 代码修改明细

### 2.1 `FHE-Protocol/contracts/BankRegistryContract.sol`（Bug 修复 · 高）

**修改函数**：`registerBank(bytes memory publicKey)`

**修改前**
```solidity
function registerBank(bytes memory publicKey) public {
    require(!banks[msg.sender].isActive, "Bank already registered");
    if (!banks[msg.sender].isActive) {          // 恒为 true
        banks[msg.sender].isActive = true;      // 只置位，什么都不登记
    } else {                                     // ← 永远不可达
        uint256 bankId = nextBankId++;
        banks[msg.sender] = Bank(publicKey, bankId, true);
        accessControl.addBank(msg.sender);
        emit BankRegistered(msg.sender, bankId);
    }
}
```

**修改后**
```solidity
function registerBank(bytes memory publicKey) public {
    require(!banks[msg.sender].isActive, "Bank already registered");

    uint256 bankId = nextBankId++;
    banks[msg.sender] = Bank(publicKey, bankId, true);

    accessControl.addBank(msg.sender);
    emit BankRegistered(msg.sender, bankId);
}
```

**修复效果**
| 项目 | 修复前 | 修复后 |
|---|---|---|
| `banks[addr]` | 不写入 | 写入 `publicKey / id / isActive=true` |
| `nextBankId` | 不递增 | 正常分配（从 1 开始） |
| `AccessControl.isBank` | false | **true** |
| `BankRegistered` 事件 | 不发出 | 正常发出（前端可拿到 `bankId`） |
| `createTask` | `Invalid bank address` | ✅ 通过 |
| `storeUserData` | `Only bank can store data` | ✅ 通过 |

**兼容性**：函数签名/ABI 未变，前端无需改代码；`BankRegistration.tsx` 反而会正常显示 `Bank ID`。

### 2.2 `FHE-Frontend/src/contracts/BankRegistryContract.sol`（同步副本）

前端仓库内的合约副本做了**同样修改**，保持与 `FHE-Protocol` 一致，避免后续照抄旧代码。

---

## 3. 新增脚本

| 脚本 | 位置 | 用途 |
|---|---|---|
| `diagnose-task.js` | `FHE-Protocol/scripts/` | 诊断/修复“无法创建任务”：打印 `isRegisteredUser`、`isBank`、`banks()`，`FIX=1` 可临时补 `addBank` |
| `setup_zhixing.sh` | `remote-setup/` | 智星云实例初始化：系统依赖 / Node20 / Rust / crates 镜像 / 代码 3 处补丁；关键步骤失败 `[FATAL]` 停止、可选步骤 `[!!]` 记录并汇总 |
| `resume_zhixing.sh` | `remote-setup/` | 一键起服务：链 → 部署 → 回填前端地址 → FHE-API → 前端 |
| `backup_zhixing.sh` | `backup-sync/` | 云端打包工作成果（代码/部署地址/日志/git 清单），默认排除大目录 |
| `pull_backup.ps1` | `backup-sync/` | 本地一键“上传备份脚本 → 云端打包 → 下载 → 解压 → 记历史” |

**diagnose-task.js 用法**
```bash
cd /root/Bisai/FHE-Protocol
# 只诊断
USER_ADDR=0x客户钱包 BANK_ADDR=0x银行钱包 npx hardhat run scripts/diagnose-task.js --network localhost
# 诊断并临时修复银行角色（旧链未重新部署时可用）
USER_ADDR=0x客户钱包 BANK_ADDR=0x银行钱包 FIX=1 npx hardhat run scripts/diagnose-task.js --network localhost
```

---

## 4. 新增文档与目录结构

本次同时整理了工作区文档/脚本的分类目录：

```text
E:\workspace\Bisai
├── docs\
│   ├── api手册（初步）.md
│   ├── CipherBridge_API_MANUAL.md        # REST + 合约完整调用手册
│   ├── CipherBridge_ARCHITECTURE.md       # 组件×调用×数据流架构图
│   └── CHANGELOG.md                       # 本修改记录
├── remote-setup\                          # 配置远程终端
│   ├── ZHIXINGYUN_GUIDE.md                # 智星云上云全流程 + 断点续跑
│   ├── setup_zhixing.sh
│   └── resume_zhixing.sh
├── backup-sync\                           # 保存文件（备份同步）
│   ├── SYNC_BACKUP_GUIDE.md
│   ├── backup_zhixing.sh
│   └── pull_backup.ps1
└── FHE-API / FHE-Frontend / FHE-Protocol / ZK-*   # 5 个项目仓库
```

---

## 5. 使修复生效的必要操作（重要）

> 改文件**不会自动生效**，链上仍是旧字节码，必须重新编译 + 重新部署。

```powershell
# ① 本地：把修复后的合约同步到云端
scp -P <SSH端口> E:\workspace\Bisai\FHE-Protocol\contracts\BankRegistryContract.sol root@<公网IP>:/root/Bisai/FHE-Protocol/contracts/
scp -P <SSH端口> E:\workspace\Bisai\FHE-Frontend\src\contracts\BankRegistryContract.sol root@<公网IP>:/root/Bisai/FHE-Frontend/src/contracts/
```
```bash
# ② 云端：编译 + 重启链 + 重新部署 + 回填前端地址 + 起服务
cd /root/Bisai/FHE-Protocol
npx hardhat compile
bash /root/resume_zhixing.sh
```
```bash
# ③ 云端：验证
USER_ADDR=0x客户钱包 BANK_ADDR=0x银行钱包 \
  npx hardhat run scripts/diagnose-task.js --network localhost
```
**预期**：银行在页面点 Register Bank 后，`AccessControl.isBank(银行) = true`；客户端“New Business Task”成功。

**页面复测顺序**：银行注册 → 银行加密并 Upload to Chain → 客户 Generate FHE Keys + Register Client → 客户 New Business Task（`Bank Address` 填 **0x 钱包地址**，不是 WeID）→ 银行 Processing → 客户 Decrypt/Sign/Publish。

**注意事项**
- **不要**给 `AccessControl.addBank` 加 `onlyAdmin`：`registerBank` 内部调用时 `msg.sender` 是 BankRegistry 合约地址，加限制会导致注册再次失败。
- 链重启/重新部署后：银行、用户需**重新注册**；FHE-API 密钥是内存态，需**重新 Generate FHE Keys**；前端 `contracts.ts` 地址需回填（`resume_zhixing.sh` 已自动处理）。

---

## 6. 回滚方法

```bash
# 撤销本次合约修复（回到修复前版本）
git -C /root/Bisai/FHE-Protocol checkout -- contracts/BankRegistryContract.sol
git -C /root/Bisai/FHE-Frontend  checkout -- src/contracts/BankRegistryContract.sol
# 重新编译并部署
cd /root/Bisai/FHE-Protocol && npx hardhat compile && bash /root/resume_zhixing.sh
```
新增的脚本/文档为纯附加内容，删除对应文件即可，不影响原项目运行。

---

## 7. 本次**未修改**的已知问题（遗留清单）

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| 1 | `UserRegistryContract.deactivateUser` | 未同步调用 `accessControl.removeUser`（对比 BankRegistry 有调用） | 注销后仍是 registeredUser，仍可建任务 |
| 2 | `TaskManagementContract.getUserPendingTasks` | 过滤条件用 `!isPublished`，与 “pending” 语义不符 | 已完成未发布任务会同时出现在 Pending 与 Completed 页签 |
| 3 | `AccessControl.addBank` | 公开无鉴权（`//onlyAdmin` 被注释） | 任何人可授予银行角色（安全后门） |
| 4 | `AccessControl.registerUser` | 公开无鉴权 | 任何人可标记任意地址为注册用户 |
| 5 | FHE-API | 密钥仅存内存、无鉴权、`generate_keys` 可覆盖他人密钥 | 重启丢钥、越权解密风险 |
| 6 | 前端 `Registration.tsx` | `registerUser` 的 `serverKey` 传字面量 `"serverKey"` | 链上与真实 seed/服务端钥未绑定 |
| 7 | 前端/合约 | 发布签名链上不验签；FHE-API 的 Ed25519 签名未被消费 | 两套签名语义并存 |
| 8 | 数据类型 | `loan/credit/mortgage` 与 `monthly_income/...` 双命名，靠前端 `taskTypeMap` 转换 | 合约层无约束 |
| 9 | ZK 两个 demo | 未接入主流程；`hello-world-7` guest 依赖路径/版本不一致 | 只能独立运行 |
| 10 | 部署地址 | `ContractTest.js` 与前端 `contracts.ts` 为两批地址 | 需统一到 `deployments.json` |

> 以上问题均已记录在 `docs/CipherBridge_API_MANUAL.md` 第 11、12 节；如需继续修复，可参考本记录第 2 节的格式追加。

---

## 8. 变更影响评估

| 维度 | 结论 |
|---|---|
| 合约 ABI | 无变化（函数签名不变），前端 ABI 无需更新 |
| 前端代码 | 无侵入；`BankRegistered` 事件恢复后 `BankRegistration.tsx` 行为更正确（能取到 bankId） |
| 链上状态 | 需重新部署，**旧链注册与数据不可迁移**（hardhat node 为内存链） |
| 依赖/环境 | 无新增依赖；仅需 `npx hardhat compile` |
| 风险 | 低；修复为“让原本就该执行的逻辑真正执行”，不改变函数对外语义 |

---

*记录人：Cline（AI 助手）｜对应文档：`docs/CipherBridge_API_MANUAL.md`、`docs/CipherBridge_ARCHITECTURE.md`、`remote-setup/ZHIXINGYUN_GUIDE.md`、`backup-sync/SYNC_BACKUP_GUIDE.md`*


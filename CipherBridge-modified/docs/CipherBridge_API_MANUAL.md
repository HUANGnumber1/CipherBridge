# CipherBridge API 调用手册（完整版）

> 适用范围：`FHE-API`(Rust :3000) + `FHE-Protocol`(Solidity, chainId 20200) + `FHE-Frontend`。
> 所有内容均依据本工作区源码逐函数整理；标注 ⚠ 的为源码中已存在的坑，调用时需绕开或先修复。

## 目录

1. [总览与运行前提](#1-总览与运行前提)
2. [FHE-API：REST 接口](#2-fhe-apirest-接口)
3. [链上合约：通用调用方式](#3-链上合约通用调用方式)
4. [AccessControl 函数手册](#4-accesscontrol-函数手册)
5. [UserRegistryContract 函数手册](#5-userregistrycontract-函数手册)
6. [BankRegistryContract 函数手册](#6-bankregistrycontract-函数手册)
7. [DataStorageContract 函数手册](#7-datastoragecontract-函数手册)
8. [TaskManagementContract 函数手册](#8-taskmanagementcontract-函数手册)
9. [事件解析（如何拿到 taskId / bankId / userId）](#9-事件解析如何拿到-taskid--bankid--userid)
10. [端到端调用示例（按业务流程逐步跑通）](#10-端到端调用示例按业务流程逐步跑通)
11. [常见错误 / FAQ](#11-常见错误--faq)
12. [附录：已知 bug 与占位说明](#12-附录已知-bug-与占位说明)

---

## 1. 总览与运行前提

| 组件      | 位置             | 服务                 | 地址                                                                  |
| ------- | -------------- | ------------------ | ------------------------------------------------------------------- |
| FHE-API | `FHE-API`      | `cargo run`        | `http://localhost:3000`                                             |
| 区块链     | `FHE-Protocol` | `npx hardhat node` | JSON-RPC `http://127.0.0.1:8545`                                    |
| 前端      | `FHE-Frontend` | `npm run dev`      | `http://localhost:3000` 资源另用 vite 代理：`/api`→8545、`/service`→FHE-API |

**通用编码约定（务必遵守）**

- FHE 密文 / FHE 公钥 / 服务端钥在链上或 HTTP 中的载体形式统一为：**TFHE-rs bincode 序列化后再 Base64 的字符串**。链上合约与前端只搬运该字符串，不解析。
- 请求体一律 `Content-Type: application/json`；FHE-API 有 10MB 请求体上限（`RequestBodyLimitLayer`）。
- 数据类型命名有两套：
  - 链上存证 `dataType`：`monthly_income`（月收入）/ `credit_score`（信用分）/ `property_value`（房产估值）；
  - 任务 `taskType`：`loan`（贷款）/ `credit`（信用评估）/ `mortgage`（抵押）。
  - 银行端调用 compute 前用映射 `loan→monthly_income, credit→credit_score, mortgage→property_value` 转换（见 `TaskList.tsx` 的 `taskTypeMap`）。
- 合约地址：各仓库已部署地址不统一——`FHE-Frontend/src/config/contracts.ts` 一份、`FHE-Protocol/test/ContractTest.js` 另一份。下文示例地址用 `<CONTRACT_ADDR>` 占位，请替换为你本地的 `deployments.json`（`FHE-Protocol/scripts/deploy.js` 生成）或上述两份文件中的任意一套，**不要混用**。

---

## 2. FHE-API：REST 接口

- 基地址：`http://localhost:3000`；前端代码经 vite 代理走相对路径 `/service`（如 `axios.post('/service/generate_keys', …)`）。
- 服务端内存态 `AppState`：`key_pairs`、`server_keys` 两个以“请求里的 `public_key` 字符串”为键的映射 + 一把服务端 Ed25519 签名钥。**所有密钥只存内存，重启即丢。**
- 无鉴权、无会话；`public_key` 字段由调用方自定义（项目里填钱包地址）。
- 缺键场景：`/encrypt`、`/compute`、`/decrypt`、`/get_public_key` 内部 `unwrap()`，键不存在会返回 **500**（非优雅 404）。
- 密钥参数：`PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS`，明文类型为 `u64`，密文统一用 `CompressedFheUint64/FheUint64`。

### 2.1 `POST /generate_keys` —— 生成并登记密钥

**作用**：为某标识符生成 (ClientKey, CompressedCompactPublicKey, CompressedServerKey)，写入服务端内存并返回三者（Base64 编码）。

**Request Body**

| 字段           | 类型     | 必填  | 说明                             |
| ------------ | ------ | --- | ------------------------------ |
| `public_key` | string | 是   | 用户标识符（项目里=钱包地址）。**重复调用会覆盖旧密钥** |

**Response 200**

| 字段               | 类型     | 说明                                      |
| ---------------- | ------ | --------------------------------------- |
| `fhe_public_key` | string | FHE 公钥（bincode+base64），可公开分发给银行用于加密     |
| `server_key`     | string | FHE 计算密钥（bincode+base64），服务端自留用于同态运算    |
| `client_key`     | string | **解密私钥（bincode+base64）**，⚠ 明文返回给调用方，勿外泄 |

**调用示例**

```bash
curl -X POST http://localhost:3000/generate_keys \
  -H "Content-Type: application/json" \
  -d '{"public_key":"0xAbC...123"}'
```

```ts
// 前端 axios（经 vite 代理 /service）
const res = await axios.post('/service/generate_keys', {
  public_key: wallet.address,
});
const { fhe_public_key, client_key } = res.data;   // server_key 前端一般不需要
```

**注意**：调用前无需任何密钥；`/decrypt` 依赖本接口把 (client_key, server_key) 登记在服务端内存里，因此**每次服务重启后，所有用户都必须重新 generate_keys** 才能继续加解密。

### 2.2 `POST /get_public_key` —— 取 FHE 公钥

**作用**：返回某标识符已登记的 FHE 公钥（银行给客户加密数据前先取这个）。

**Request Body**

| 字段           | 类型     | 必填  | 说明                       |
| ------------ | ------ | --- | ------------------------ |
| `public_key` | string | 是   | 用户标识符，需先 generate_keys 过 |

**Response 200**

| 字段               | 类型     | 说明                     |
| ---------------- | ------ | ---------------------- |
| `fhe_public_key` | string | FHE 公钥（bincode+base64） |
| `server_key`     | string | 固定 `""`（不返回）           |
| `client_key`     | string | 固定 `""`（不返回）           |

**调用示例**

```bash
curl -X POST http://localhost:3000/get_public_key \
  -H "Content-Type: application/json" \
  -d '{"public_key":"0xAbC...123"}'
```

```ts
const fhePublicKey = (await axios.post('/service/get_public_key', {
  public_key: userAddress,
})).data.fhe_public_key;
```

**⚠ 注意**：该标识符未 generate_keys 时返回 500（服务端 unwrap）。

### 2.3 `POST /encrypt` —— 加密一个 u64 明文

**作用**：用该标识符的 ClientKey 把单个数值加密为 `CompressedFheUint64`（bincode+base64）。

**Request Body**

| 字段           | 类型          | 必填  | 说明                                                |
| ------------ | ----------- | --- | ------------------------------------------------- |
| `public_key` | string      | 是   | 用户标识符（该用户须已 generate_keys）                        |
| `data_type`  | string      | 是   | 语义类型标签，如 `monthly_income`；**服务端不校验、不参与加密**，仅作调用约定 |
| `value`      | number(u64) | 是   | 明文数值                                              |

**Response 200**

| 字段                | 类型     | 说明                                    |
| ----------------- | ------ | ------------------------------------- |
| `encrypted_value` | string | 密文（bincode+base64），可直接存链 / 参与 compute |

**调用示例**

```bash
curl -X POST http://localhost:3000/encrypt \
  -H "Content-Type: application/json" \
  -d '{"public_key":"0xAbC...123","data_type":"monthly_income","value":28000}'
```

```ts
const { encrypted_value } = (await axios.post('/service/encrypt', {
  public_key: userAddress,
  data_type: 'monthly_income',
  value: 28000,
})).data;
```

### 2.4 `POST /compute` —— 密文求和（同态计算）

**作用**：对同一用户的一组密文做同态 `+`，返回仍加密的求和结果。实现：逐个 `base64→bincode 反序列化→decompress→相加→compress→base64`。

**Request Body**

| 字段                 | 类型       | 必填  | 说明                                                                           |
| ------------------ | -------- | --- | ---------------------------------------------------------------------------- |
| `public_key`       | string   | 是   | 用户标识符，需已登记 server_key                                                        |
| `task_id`          | string   | 是   | 任务编号（当前仅透传日志用，不参与计算）                                                         |
| `data_type`        | string   | 是   | 类型标签，如 `monthly_income`                                                      |
| `encrypted_values` | string[] | 是   | 至少 1 个密文（来自 `/encrypt` 或 DataStorage.getDataByUserAndType 的 `encryptedData`） |

**Response 200**

| 字段       | 类型     | 说明                     |
| -------- | ------ | ---------------------- |
| `result` | string | 求和结果密文（bincode+base64） |

**调用示例**

```bash
curl -X POST http://localhost:3000/compute \
  -H "Content-Type: application/json" \
  -d '{"public_key":"0xAbC...123","task_id":"3","data_type":"monthly_income","encrypted_values":["<base64>","<base64>"]}'
```

```ts
const { result } = (await axios.post('/service/compute', {
  public_key: task.userAddress,
  task_id: task.taskId,
  data_type: taskTypeMap[task.taskType],   // loan→monthly_income
  encrypted_values: userData.map(d => d.encryptedData),
})).data;
```

### 2.5 `POST /decrypt` —— 解密并附服务端 Ed25519 签名

**作用**：用该标识符登记在服务端的 ClientKey 解密一个密文为 `u64` 明文，并用服务端 Ed25519 私钥对明文的 little-endian 字节签名后一并返回。

**Request Body**

| 字段                | 类型     | 必填  | 说明                                                            |
| ----------------- | ------ | --- | ------------------------------------------------------------- |
| `public_key`      | string | 是   | 用户标识符（该用户须已 generate_keys）                                    |
| `data_type`       | string | 是   | 类型标签；**服务端忽略此字段**                                             |
| `encrypted_value` | string | 是   | 待解密密文（bincode+base64，通常来自 completeTask 存入的 `encryptedResult`） |

**Response 200**

| 字段          | 类型          | 说明                                              |
| ----------- | ----------- | ----------------------------------------------- |
| `value`     | number(u64) | 解密得到的明文                                         |
| `signature` | string      | 服务端 Ed25519 对 `value.to_le_bytes()` 的签名（base64） |

**调用示例**

```bash
curl -X POST http://localhost:3000/decrypt \
  -H "Content-Type: application/json" \
  -d '{"public_key":"0xAbC...123","data_type":"loan","encrypted_value":"<base64>"}'
```

```ts
const { value, signature } = (await axios.post('/service/decrypt', {
  public_key: wallet.address,
  data_type: currentTask.businessType,   // 前端直接传 loan/credit/mortgage（服务端忽略）
  encrypted_value: task.encryptedResult,
})).data;
```

**⚠ 注意**：① 无鉴权，任何人只要知道某用户地址且服务端内存里有其密钥，就能解密拿明文；② 返回的 `signature` 在现有前端流程中并未使用（前端改用 ethers 本地对 `hash(明文)` 签名并上传合约）。

---

## 3. 链上合约：通用调用方式

### 3.1 部署拓扑与地址

```text
AccessControl (先部署)
  ├─ UserRegistryContract(_accessControl)
  ├─ BankRegistryContract(_accessControl)
  ├─ DataStorageContract(_accessControl)
  └─ TaskManagementContract(_accessControl)
```

- 部署脚本：`FHE-Protocol/scripts/deploy.js`（`npx hardhat run scripts/deploy.js`），输出 `deployments.json`。
- 本地起链：`npx hardhat node`（chainId 20200，已配置固定私钥账户）。
- **必须使用同一套 AccessControl 地址部署其余 4 个合约**，否则权限不互通。

### 3.2 获取 ABI 与地址

- 前端（ether.js 用）：`FHE-Frontend/src/abis/*.js`（含 `AccessControlABI`、`UserRegistryABI` 等）。
- 合约工程：`FHE-Protocol/artifacts/contracts/**/*.json`（`npx hardhat compile` 生成）。

### 3.3 初始化合约对象

前端 ethers v5（与 `FHE-Frontend` 一致）：

```ts
import { ethers } from 'ethers';          // ^5.7.2
const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545'); // 前端代码里是 '/api' 代理
const signer  = new ethers.Wallet('<用户私钥>', provider);
const tm = new ethers.Contract(CONTRACT_ADDR.TaskManagement, TaskManagementABI, signer);
// 只读视角：new ethers.Contract(addr, abi, provider)
```

测试/脚本 ethers v6（与 `FHE-Protocol/test/ContractTest.js` 一致，hardhat-toolbox）：

```js
const hre = require('hardhat');
const tm = await hre.ethers.getContractAt('TaskManagementContract', CONTRACT_ADDR.TaskManagement, signer);
// ethers v6 里 tx 需手动 await tx.wait()，事件从 receipt.logs 解析（见第9节）
```

> 下文合约示例默认给 **ethers v5（前端风格）**；每节视情况补 v6 差异。

---

## 4. AccessControl 函数手册

角色中心，被其余合约引用做鉴权。公开只读 getter：`isAdmin(address) / isBank(address) / isRegisteredUser(address)` → `bool`。

```ts
const ac = new ethers.Contract(ADDR.AccessControl, AccessControlABI, signer);
await ac.isBank(bankAddress);            // → boolean
await ac.isRegisteredUser(userAddress);  // → boolean
```

### 4.1 `addAdmin(address account)` ｜ 仅 admin

把他人设为管理员。

```ts
const tx = await ac.addAdmin(newAdmin); await tx.wait();
```

事件：`AdminAdded(indexed account)`。参数：`account`=目标地址。

### 4.2 `removeAdmin(address account)` ｜ 仅 admin

撤销管理员。事件：`AdminRemoved(account)`。

### 4.3 `addBank(address account)` ｜ ⚠ 当前公开无鉴权

标记某地址为银行。

```ts
const tx = await ac.addBank(bankAddress); await tx.wait();   // 绕过 BankRegistry bug 的临时手段
```

事件：`BankAdded(account)`。

### 4.4 `removeBank(address account)` ｜ 仅 admin

撤销银行角色。事件：`BankRemoved(account)`。被 `BankRegistryContract.deactivateBank` 内部调用。

### 4.5 `registerUser(address account)` ｜ 公开

标记某地址为注册用户。正常业务由 `UserRegistryContract.registerUser` 内部调用。
事件：`UserRegistered(account)`。

### 4.6 `removeUser(address account)` ｜ 仅 admin

撤销用户角色。事件：`UserRemoved(account)`。
⚠ 源码中 `UserRegistryContract.deactivateUser` **没有**调用它（不一致），需要时可手动调。

---

## 5. UserRegistryContract 函数手册

登记用户身份与 FHE 密钥。公开 getter：`users(address) → {publicKey(bytes), fhePublicKey(string), serverKey(string), id(uint256), isActive(bool)}`、`nextUserId() → uint256`。

```ts
const ur = new ethers.Contract(ADDR.UserRegistry, UserRegistryABI, signer);
const u  = await ur.users(userAddress);   // 取结构体字段用 u.isActive / u.id
```

### 5.1 `registerUser(bytes publicKey, string fhePublicKey, string serverKey)` ｜ 本人登记

**作用**：以 `msg.sender` 为用户登记并开通“注册用户”角色。谁调用就是登记谁。

**参数**

| 参数             | 类型     | 含义                                         | 校验                                           |
| -------------- | ------ | ------------------------------------------ | -------------------------------------------- |
| `publicKey`    | bytes  | 区块链公钥（前端传钱包地址字符串 `0x…`）                    | 无长度限制                                        |
| `fhePublicKey` | string | FHE 公钥（`/generate_keys` 返回，bincode+base64） | 非空，否则 `"Invalid keys"`                       |
| `serverKey`    | string | 服务端钥                                       | 非空，否则 `"Invalid keys"`（⚠ 前端写死 `"serverKey"`） |

**前置条件**：`users[msg.sender].isActive == false`，否则 `"User already registered"`。
**返回**：无；id 从 `UserRegistered` 事件读取。
**副作用**：分配自增 id → 写 `users` → 内部调 `accessControl.registerUser(msg.sender)` → 发事件 `UserRegistered(msg.sender, userId)`。

```ts
const tx = await ur.registerUser(wallet.address, keys.publicKey, "serverKey");
await tx.wait();
```

> ethers 会把 `wallet.address`(string) 按 UTF-8 转 bytes；若想存原始地址也可 `ethers.utils.arrayify(wallet.address)`，但 **需与读取端保持一致**（项目当前用字符串方式）。

### 5.2 `deactivateUser(address userAddress)` ｜ admin 或本人

**作用**：注销用户（置 `isActive=false`）。

```ts
await (await ur.deactivateUser(userAddress)).wait();
```

⚠ 该函数**未同步调用** `accessControl.removeUser`，注销后 `isRegisteredUser` 仍为 true，仍可建任务。

### 5.3 `getUser(address userAddress) view returns (User)` ｜ 公开只读

要求 active，否则 `"User not active"`。返回结构体全部字段。

```ts
const user = await ur.getUser(userAddress);
// user.publicKey / user.fhePublicKey / user.serverKey / user.id / user.isActive
```

---

## 6. BankRegistryContract 函数手册

登记银行身份。公开 getter：`banks(address) → {publicKey(bytes), id(uint256), isActive(bool)}`、`nextBankId() → uint256`。

```ts
const br = new ethers.Contract(ADDR.BankRegistry, BankRegistryABI, signer);
const b  = await br.getBank(bankAddress);
```

### 6.1 `registerBank(bytes publicKey)` ｜ 本人登记（🔴 源码有 bug）

**设计作用**：以 `msg.sender` 登记银行并开通“银行”角色。
**参数**：`publicKey`(bytes) — 银行区块链公钥（前端传银行钱包地址）。

```ts
const tx = await br.registerBank(bankWallet.address);   // 期望 emit BankRegistered
const receipt = await tx.wait();
```

**🔴 实际行为（必须先知道）**：函数主体逻辑被写进**不可达的 else 分支**，调用后只会把 `banks[msg.sender].isActive` 置 true——`publicKey` 未存、`id` 未分配、`accessControl.addBank` 未调用、`BankRegistered` 事件**永不发出**。
**影响**：`getBank` 能读（返回 `{publicKey:'', id:0, isActive:true}`），前端显示注册成功，但该银行在 AccessControl 中**不是银行**，后续 `DataStorage.storeUserData`（要求 `isBank`）与 `TaskManagement.createTask`（要求目标地址 `isBank`）会直接 revert。
**临时绕开方案（不改合约时的做法）**：注册后由管理员补一步，或在测试中直接调用（项目测试 `ContractTest.js` 即这种方式）：

```ts
await (await ac.addBank(bankAddress)).wait();   // 让 AccessControl 认可该地址为银行
```

### 6.2 `deactivateBank(address bankAddress)` ｜ admin 或银行本人

注销银行并**同步** `accessControl.removeBank`。要求 active。

```ts
await (await br.deactivateBank(bankAddress)).wait();
```

事件：`BankDeactivated(bankAddress, bankId)`。

### 6.3 `getBank(address bankAddress) view returns (Bank)` ｜ 公开只读

要求 active，否则 `"Bank not active"`。返回 `{publicKey, id, isActive}`。

```ts
const bank = await br.getBank(bankAddress);   // bank.id / bank.isActive
```

---

## 7. DataStorageContract 函数手册

加密数据存证库。公开 getter：`dataEntries(uint256 index) → {userAddress, bankAddress, dataType, expiryDate, encryptedData}`（注意是**动态数组**，越界 revert）。

### 7.1 `storeUserData(address userAddress, string dataType, uint256 expiryDate, string encryptedData)` ｜ 仅 bank

**作用**：银行把“某用户的某类加密数据”上链存证，带过期时间。

**参数**

| 参数              | 类型      | 含义                       | 校验失败提示                                         |
| --------------- | ------- | ------------------------ | ---------------------------------------------- |
| `userAddress`   | address | 数据归属用户                   | 必须已注册：`"Invalid user"`                         |
| `dataType`      | string  | 数据类型（`monthly_income` 等） | 无枚举校验                                          |
| `expiryDate`    | uint256 | 过期 Unix 时间(秒)            | 必须 `> block.timestamp`：`"Invalid expiry date"` |
| `encryptedData` | string  | FHE 密文（来自 `/encrypt`）    | 无格式校验                                          |

**访问控制**：`isBank(msg.sender)`，否则 `"Only bank can store data"`。

```ts
const ds = new ethers.Contract(ADDR.DataStorage, DataStorageABI, bankSigner);
const block = await provider.getBlock('latest');
const expiry = block.timestamp + 30 * 24 * 3600;               // 30 天后过期
const tx = await ds.storeUserData(
  userAddress,          // 归属用户
  'monthly_income',     // 类型（前端留空段为可选项）
  expiry,
  encryptedValue        // /encrypt 返回的 base64 密文
);
await tx.wait();        // 成功会 emit DataStored
```

事件：`DataStored(indexed userAddress, indexed bankAddress, dataType, indexed expiryDate)`。
⚠ 相同(用户,类型)可重复存储，不去重；过期只影响查询不删除数据。

### 7.2 `getDataByUserAndType(address userAddress, string dataType) view returns (DataEntry[])` ｜ 该用户或 bank

**作用**：取某用户某类型**当前仍有效**（`expiryDate > block.timestamp`）的全部数据记录。

```ts
const dsRead = new ethers.Contract(ADDR.DataStorage, DataStorageABI, signer); // signer 需为本人或银行
const entries = await dsRead.getDataByUserAndType(userAddress, 'monthly_income');
for (const e of entries) {
  e.userAddress; e.bankAddress; e.dataType; e.expiryDate;
  e.encryptedData;   // 交给 /compute 使用
}
```

访问控制：`isBank(msg.sender) || msg.sender == userAddress`，否则 `"Not authorized"`。无匹配时返回空数组。

---

## 8. TaskManagementContract 函数手册

业务核心：任务生命周期 `pending → completed → published`。
公开 getter：`tasks(uint256) → Task`、`nextTaskId() → uint256`、`bankTasks(address) → uint256[]`、`userTasks(address) → uint256[]`。

```ts
const tm = new ethers.Contract(ADDR.TaskManagement, TaskManagementABI, signer);
```

### 8.1 `createTask(address bankAddress, string taskType)` ｜ 仅注册用户

**作用**：用户向指定银行发起隐私计算任务；`msg.sender` 即任务归属用户。
**参数**：`bankAddress`=执行银行（须 `isBank`，否则 `"Invalid bank address"`）；`taskType`=`loan/credit/mortgage`（合约不校验枚举）。
**前置条件**：`isRegisteredUser(msg.sender)`，否则 `"User not registered"`。
**返回**：无；**taskId 从 `TaskCreated` 事件拿**（见第 9 节）。

```ts
const tx = await tm.createTask(bankAddress, 'loan');
const receipt = await tx.wait();
// 从事件解析 taskId —— 写法见第 9 节
```

事件：`TaskCreated(indexed taskId, indexed bankAddress, indexed userAddress, taskType)`。
副作用：`nextTaskId++` → 写 `tasks[taskId]`（`createdAt=now`、结果/签名空、双状态 false）→ 记入 `bankTasks[bank]`、`userTasks[user]`。

### 8.2 `completeTask(uint256 taskId, string result)` ｜ 仅该任务的指派银行

**作用**：银行在链外调 `/compute` 后，把**结果密文**写回任务。
**前置条件**：`isBank(msg.sender)`（`"Caller is not bank"`）；`msg.sender == tasks[taskId].bankAddress`（`"Not assigned bank"`）；`!isCompleted`（`"Task already completed"`）。

```ts
const tx = await tm.completeTask(taskId, computationResult); // computationResult=/compute 的 result
await tx.wait();                                             // emit TaskCompleted(taskId, result)
```

事件：`TaskCompleted(taskId, result)`。
⚠ 合约不校验 `result` 的合法性与正确性（链外 ZK/可信服务负责）。

### 8.3 `publishTaskResult(uint256 taskId, bytes signature)` ｜ 仅任务归属用户

**作用**：用户确认并“发布”结果，上传签名留痕。
**前置条件**：`isRegisteredUser(msg.sender)`；`msg.sender == tasks[taskId].userAddress`（`"Not task owner"`）；已 completed（`"Task not completed"`）；未发布（`"Task already published"`）。

```ts
// 前置：先调 /decrypt 拿明文，再本地对 hash(明文) 签名
const decryptedResult = String(value);                       // /decrypt 返回的明文
const messageHash   = ethers.utils.id(decryptedResult);      // keccak256
const signature     = await new ethers.Wallet(userPrivKey).signMessage(
                        ethers.utils.arrayify(messageHash));
const tx = await tm.publishTaskResult(taskId, signature);    // bytes 参数
await tx.wait();                                             // emit TaskPublished(taskId, signature)
```

事件：`TaskPublished(taskId, signature)`。
⚠ 合约**只存不验签**；`signature` 格式由链下约定（当前为 ethers 对 hash(明文) 的签名）。

### 8.4 查询函数（均为 view，ethers v5 直接 `await` 返回，无需 wait）

| #   | 函数签名                                                     | 访问控制         | 返回          | 筛选逻辑                                        |
| --- | -------------------------------------------------------- | ------------ | ----------- | ------------------------------------------- |
| Q1  | `getTask(uint256 taskId)`                                | 公开           | `Task`      | 无（不存在的 id 返回全空字段 Task）                      |
| Q2  | `getBankTasks(address bankAddress)`                      | 该银行本人或 admin | `uint256[]` | 该银行全部任务 ID                                  |
| Q3  | `getUserTasks(address userAddress)`                      | 该用户本人或 admin | `uint256[]` | 该用户全部任务 ID                                  |
| Q4  | `getBankPendingTasks(address bankAddress)`               | **仅银行本人**    | `Task[]`    | `!isCompleted`（待办）                          |
| Q5  | `getUserPendingTasks(address userAddress)`               | **仅用户本人**    | `Task[]`    | ⚠ 实际筛 `!isPublished`（会把“已完成未发布”也放进 pending） |
| Q6  | `getBankCompletedUnpublishedTasks(address bankAddress)`  | 本人或 admin    | `Task[]`    | `isCompleted && !isPublished`，且地址须为 bank    |
| Q7  | `getUserCompletedUnpublishedTasks(address userAddress)`  | 本人或 admin    | `Task[]`    | `isCompleted && !isPublished`，且地址须为注册用户     |
| Q8  | `getBankCompletedAndPublishedTasks(address bankAddress)` | 本人或 admin    | `Task[]`    | `isCompleted && isPublished`                |
| Q9  | `getUserCompletedAndPublishedTasks(address userAddress)` | 本人或 admin    | `Task[]`    | `isCompleted && isPublished`                |

**Task 结构体字段**（前端读取时命名）：
`taskId(uint256)`、`bankAddress(address)`、`userAddress(address)`、`taskType(string)`、`encryptedResult(string)`、`signature(bytes)`、`isCompleted(bool)`、`isPublished(bool)`、`createdAt(uint256)`。

**调用示例（银行拉三类任务，对应前端 TaskList.tsx）**

```ts
const tm = new ethers.Contract(ADDR.TaskManagement, TaskManagementABI, bankSigner);
const [pending, completed, published] = await Promise.all([
  tm.getBankPendingTasks(bankAddress),
  tm.getBankCompletedUnpublishedTasks(bankAddress),
  tm.getBankCompletedAndPublishedTasks(bankAddress),
]);
const fmt = (list) => list.map(t => ({
  taskId: t.taskId.toString(), userAddress: t.userAddress,
  taskType: t.taskType, encryptedResult: t.encryptedResult,
  isCompleted: t.isCompleted, isPublished: t.isPublished,
  createdAt: parseInt(t.createdAt._hex, 16),   // BigNumber → number（v6 用 Number(t.createdAt)）
}));
```

**单任务读取**

```ts
const t = await tm.getTask(taskId);
console.log(t.encryptedResult, t.signature, t.isCompleted, t.isPublished);
```

---

## 9. 事件解析（如何拿到 taskId / bankId / userId）

`createTask/registerUser/registerBank` 等写函数不直接返回 id，需要从交易回执里解析事件。

### ethers v5（前端）

```ts
const receipt = await (await tm.createTask(bank, 'loan')).wait();
const ev = receipt.events?.find((e: any) => e.event === 'TaskCreated');
const taskId = ev.args.taskId.toNumber();      // uint256 → number
```

### ethers v6（hardhat 测试/脚本）

```js
const receipt = await (await tm.createTask(bank, 'loan')).wait();
const ev = receipt.logs
  .map((log) => { try { return tm.interface.parseLog(log); } catch { return null; } })
  .find((p) => p && p.name === 'TaskCreated');
const taskId = ev.args.taskId;   // bigint
```

**各合约事件速查**

| 合约             | 事件                                   | args                                                            |
| -------------- | ------------------------------------ | --------------------------------------------------------------- |
| AccessControl  | `AdminAdded/AdminRemoved`            | `account`                                                       |
| AccessControl  | `BankAdded/BankRemoved`              | `account`                                                       |
| AccessControl  | `UserRegistered/UserRemoved`         | `account`                                                       |
| UserRegistry   | `UserRegistered` / `UserDeactivated` | `userAddress`(indexed), `userId`(indexed)                       |
| BankRegistry   | `BankRegistered` / `BankDeactivated` | `bankAddress`(indexed), `bankId`(indexed)                       |
| DataStorage    | `DataStored`                         | `userAddress`(i), `bankAddress`(i), `dataType`, `expiryDate`(i) |
| TaskManagement | `TaskCreated`                        | `taskId`(i), `bankAddress`(i), `userAddress`(i), `taskType`     |
| TaskManagement | `TaskCompleted`                      | `taskId`, `result`                                              |
| TaskManagement | `TaskPublished`                      | `taskId`, `signature`                                           |

---

## 10. 端到端调用示例（按业务流程逐步跑通）

以下是一个可独立运行的 Node 脚本骨架（Node 18+），把“REST + 合约”串成全链路。需要：FHE-API 已启动、本地链已部署、`axios` 与 `ethers@5` 已安装，并自行填入地址与私钥。

```js
// run-flow.js —— 按业务流程调用的完整骨架
const axios = require('axios');
const { ethers } = require('ethers');
const { UserRegistryABI, BankRegistryABI, DataStorageABI, TaskManagementABI } = require('./abis');

const RPC   = 'http://127.0.0.1:8545';
const FHE   = 'http://localhost:3000';
const ADDR  = { /* 填 deploy.js 输出或前端 config 的地址 */
  UserRegistry: '0x…', BankRegistry: '0x…', DataStorage: '0x…',
  TaskManagement: '0x…', AccessControl: '0x…' };

const provider = new ethers.providers.JsonRpcProvider(RPC);
// 演示用随机钱包；实际项目要求银行地址已被 AccessControl 认可为 bank
const userKey = ethers.Wallet.createRandom(); const user = userKey.connect(provider);
const bankKey = ethers.Wallet.createRandom(); const bank = bankKey.connect(provider);
const registry = (addr, abi, s) => new ethers.Contract(addr, abi, s);

(async () => {
  // ① 客户生成 FHE 密钥（FHE-API 内存登记）
  const gk = (await axios.post(`${FHE}/generate_keys`, { public_key: user.address })).data;
  console.log('keys ok, fhe pk len=', gk.fhe_public_key.length);

  // ② 客户注册上链（⚠ serverKey 为占位字符串）
  await (await registry(ADDR.UserRegistry, UserRegistryABI, user)
    .registerUser(user.address, gk.fhe_public_key, 'serverKey')).wait();

  // ③ 银行注册 + （当前合约 bug 需要）管理员补 addBank
  //    银行若已由其它方式登记为 bank，可跳过本步
  // const admin = ...; await (await ac.addBank(bank.address)).wait();
  await (await registry(ADDR.BankRegistry, BankRegistryABI, bank).registerBank(bank.address)).wait();

  // ④ 银行加密一条数据并存证（30 天有效）
  const enc = (await axios.post(`${FHE}/encrypt`,
    { public_key: user.address, data_type: 'monthly_income', value: 20000 })).data.encrypted_value;
  const block = await provider.getBlock('latest');
  await (await registry(ADDR.DataStorage, DataStorageABI, bank)
    .storeUserData(user.address, 'monthly_income', block.timestamp + 30 * 86400, enc)).wait();

  // ⑤ 客户建任务
  let r = await (await registry(ADDR.TaskManagement, TaskManagementABI, user)
    .createTask(bank.address, 'loan')).wait();
  const taskId = r.events.find(e => e.event === 'TaskCreated').args.taskId.toNumber();

  // ⑥ 银行处理：拉密文 → /compute 求和 → completeTask
  const entries = await registry(ADDR.DataStorage, DataStorageABI, bank)
    .getDataByUserAndType(user.address, 'monthly_income');
  const sum = (await axios.post(`${FHE}/compute`, {
    public_key: user.address, task_id: String(taskId),
    data_type: 'monthly_income',
    encrypted_values: entries.map(e => e.encryptedData),
  })).data.result;
  await (await registry(ADDR.TaskManagement, TaskManagementABI, bank)
    .completeTask(taskId, sum)).wait();

  // ⑦ 客户解密 + 签名 + 发布
  const task = await registry(ADDR.TaskManagement, TaskManagementABI, provider).getTask(taskId);
  const dec = (await axios.post(`${FHE}/decrypt`, {
    public_key: user.address, data_type: 'loan',
    encrypted_value: task.encryptedResult })).data;
  const sig = await userKey.signMessage(ethers.utils.arrayify(ethers.utils.id(String(dec.value))));
  await (await registry(ADDR.TaskManagement, TaskManagementABI, user)
    .publishTaskResult(taskId, sig)).wait();

  // ⑧ 校验最终状态
  const finalTask = await registry(ADDR.TaskManagement, TaskManagementABI, provider).getTask(taskId);
  console.log('done: task', taskId, 'completed=', finalTask.isCompleted,
              'published=', finalTask.isPublished, 'plaintext=', dec.value);
})();
```

> 对应 UI 映射：`TaskList.tsx`（⑥）、`TaskResults.tsx`（⑤⑦⑧）、`DataEncryption.tsx`（④）、`Registration.tsx`（①②）、`BankRegistration.tsx`（③）。前端签名/发布也保持一致逻辑。

---

## 11. 常见错误 / FAQ

| 现象                                                  | 原因                                       | 处理                                                        |
| --------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `POST /decrypt                                      | /encrypt                                 | /compute                                                  |
| `Only bank can store data` / `Invalid bank address` | 银行地址未被 AccessControl 认可                  | 修复 BankRegistry 合约或由 admin 手动 `addBank`                   |
| `User not registered`（createTask/storeUserData）     | 用户没走 `UserRegistryContract.registerUser` | 先完成注册；注意 UserRegistry 与 DataStorage 共用同一 AccessControl 实例 |
| `Not authorized`（getDataByUserAndType）              | 调用者既非该用户也非 bank                          | 换签名方                                                      |
| `Invalid expiry date`                               | `expiryDate <= block.timestamp`          | 用 `getBlock('latest').timestamp + 30*86400`               |
| `Task already completed` / `already published`      | 重复 complete/publish                      | 查询 `getTask` 看状态再操作                                       |
| 读取到 `task.createdAt` 是对象                            | BigNumber                                | v5: `parseInt(x._hex,16)`；v6: `Number(x)`                 |
| 事件解析为空                                              | ethers v6 需 parseLog                     | 见第 9 节写法                                                  |
| 前端连不上链                                              | vite 代理 `/api`→8545 或后端未启动               | `npx hardhat node` + `npm run dev`                        |
| 提交超时                                                | 大字符串（FHE 公钥 base64 很大）导致交易体/节点限制         | 保持本地演示网络；生产需换存储或压缩                                        |

---

## 12. 附录：已知 bug 与占位说明

1. `BankRegistryContract.registerBank`：登记主体在不可达 else 分支（见 §6.1），需修复后才能“注册即开通银行角色”。
2. `UserRegistryContract.deactivateUser`：未同步 `accessControl.removeUser`。
3. `TaskManagementContract.getUserPendingTasks`：筛选用 `!isPublished` 与命名不符。
4. FHE-API 无鉴权、密钥只存内存且 `generate_keys` 会覆盖旧钥；`/decrypt` 暴露明文给任何能调用的人。
5. `registerUser` 的 `serverKey` 为前端写死占位符 `"serverKey"`；链上与 FHE-API 的真实 server_key 并未绑定。
6. 发布签名未在链上校验；FHE-API 的 Ed25519 服务端签名当前未被业务消费（两套签名语义并存）。
7. FHE-API `Cargo.toml` 开启 `x86_64-unix`/`gpu` features，Windows 直接编译会失败（建议 Linux/WSL 构建，或按平台调整 features）。
8. 数据类型双命名（`loan/credit/mortgage` vs `monthly_income/credit_score/property_value`）靠前端 `taskTypeMap` 转换，合约无约束。
9. 部署地址不统一：`FHE-Frontend/src/config/contracts.ts` 与 `FHE-Protocol/test/ContractTest.js` 是两套地址，跑流程前务必统一到同一份部署。

---

*本文档由工作区源码自动核对生成；若你修改了合约或 FHE-API 源码，请同步更新对应章节。*

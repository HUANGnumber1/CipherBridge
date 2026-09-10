## A. FHE-API（REST，`http://localhost:3000`）

统一说明：`Content-Type: application/json`，请求体限 10MB；凡涉及密文均为 **bincode+base64** 字符串。

### A1. `POST /generate_keys` — 生成密钥

```json
// Request请求写法
{ "public_key": "<用户标识，代码里用钱包地址>" }
// Response 200（预期返回，用于生成测试所需的公钥和私钥）
{
  "fhe_public_key": "<base64, CompressedCompactPublicKey>",
  "server_key":    "<base64, CompressedServerKey>",
  "client_key":    "<base64, ClientKey，解密密钥，服务端也会自留>"
}
```

### A2. `POST /get_public_key` — 取 FHE 公钥

```json
// Request   { "public_key": "0x..." }
// Response  { "fhe_public_key": "<base64>", "server_key": "", "client_key": "" }
```

注意：若该标识符从未 `generate_keys`，内部 `unwrap()` 会让服务端 panic 并返回 500。

### A3. `POST /encrypt` — 加密一个 u64

```json
// Request
{ "public_key": "0x...", "data_type": "monthly_income", "value": 12000 }
// Response 200  { "encrypted_value": "<base64 CompressedFheUint64>" }
```

### A4. `POST /compute` — 密文求和（目前唯一计算）

```json
// Request
{
  "public_key": "0x...", "task_id": "3",
  "data_type": "monthly_income",
  "encrypted_values": ["<base64>", "<base64>", "..."]
}
// Response 200  { "result": "<base64 压缩后的求和结果密文>" }
```

实现：逐个反序列化、decompress、`+`，结果再 `compress()`。

### A5. `POST /decrypt` — 解密并附带服务端 Ed25519 签名

```json
// Request
{ "public_key": "0x...", "data_type": "loan", "encrypted_value": "<base64>" }
// Response 200
{ "value": 28000, "signature": "<base64, Ed25519(value的little-endian字节)>" }
```

> 前端封装在 `FHE-Frontend/src/services/fheApi.ts`（`generateKeys/getPublicKey/encrypt/compute/decrypt`，base `/service`）；`FHE-Protocol/scripts/fheApi.ts` 与 `FHE-API/test/api.js` 是同类测试客户端。

## B. 链上合约函数手册（FHE-Protocol / FISCO chainId 20200）

| 合约                         | 写函数                                                                                                                  | 查询函数                                                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AccessControl**          | `addAdmin/removeAdmin(addr)`、`addBank(addr)`（无鉴权）、`removeBank(addr)`、`registerUser(addr)`（公开）、`removeUser(addr)`     | `isAdmin/isBank/isRegisteredUser(addr):bool`                                                                                                                                                                                            |
| **UserRegistryContract**   | `registerUser(bytes pubKey,string fhePublicKey,string serverKey)`、`deactivateUser(addr)`                             | `users(addr)`、`getUser(addr)`、`nextUserId`                                                                                                                                                                                              |
| **BankRegistryContract**   | `registerBank(bytes publicKey)`、`deactivateBank(addr)`                                                               | `banks(addr)`、`getBank(addr)`、`nextBankId`                                                                                                                                                                                              |
| **DataStorageContract**    | `storeUserData(addr user,string type,uint expiry,string encryptedData)`                                              | `dataEntries(uint)`、`getDataByUserAndType(addr,string)`                                                                                                                                                                                 |
| **TaskManagementContract** | `createTask(addr bank,string taskType)`、`completeTask(uint,string result)`、`publishTaskResult(uint,bytes signature)` | `tasks(uint)`、`getTask`、`getBankTasks/getUserTasks`、`getBankPendingTasks/getUserPendingTasks`、`getBankCompletedUnpublishedTasks/getUserCompletedUnpublishedTasks`、`getBankCompletedAndPublishedTasks/getUserCompletedAndPublishedTasks` |

前端 ABIs 在 `FHE-Frontend/src/abis/*.js`（与 .sol 一致），合约源码在 FHE-Protocol 与 FHE-Frontend/src/contracts 各有一份副本。**注意**：`ContractTest.js` 里硬编码的合约地址（`0x412d…` 等）与前端 `config/contracts.ts`（`0x4c02…` 等）不是同一批部署，二者需对齐。

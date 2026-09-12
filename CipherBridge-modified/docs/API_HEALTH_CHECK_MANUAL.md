# CipherBridge 各 API 有效性检测操作手册

> 适用场景：远程主机（智星云）上部署后，逐项确认 **FHE-API、链上 RPC、前端代理** 是否可用；也适合本地一键体检。
> 配套脚本：`remote-setup/check_apis.sh`（自动执行下文 1~3 节全部检测并输出汇总）。

---

## 0. 检测前准备

### 0.1 端口与端点总览

| 服务 | 地址 | 判定依据 |
|---|---|---|
| FHE-API | `http://<主机>:3000` | 5 个 REST 端点返回预期 JSON |
| 区块链 RPC | `http://<主机>:8545` | JSON-RPC 返回 `chainId=20200` |
| 前端 Vite | `http://<主机>:5173` | 首页返回 HTML；`/api`、`/service` 代理可用 |

> 在云实例本机检测用 `127.0.0.1`；从本地电脑检测需先建 SSH 隧道，或把 `<主机>` 换成公网 IP（**仅建议对内网暴露**）。

### 0.2 通用命令模板

```bash
# 通用 JSON 请求模板（后面各节都用它）
curl -s -X POST http://127.0.0.1:<端口>/<路径> \
  -H 'Content-Type: application/json' \
  -d '<JSON>'
```

### 0.3 检测前 30 秒预检

```bash
# 1) 三个端口是否在监听（缺哪个先补哪个服务）
ss -lntp | grep -E '3000|8545|5173' || echo "有端口未监听"

# 2) 对应 tmux 会话是否存在
tmux ls

# 3) FHE-API 最近日志有无报错
tail -n 20 /tmp/fhe_api.log
```

---

## 1. FHE-API（REST，端口 3000）检测

> 约定：以下 `<PK>` 是一个稳定的标识符（业务里是客户钱包地址），5 个端点共用。
> ⚠ 密钥只存内存：FHE-API 重启后必须重新执行 1.2，否则 1.3~1.6 会报 500。

### 1.1 服务进程 / 端口检测

```bash
ss -lntp | grep 3000
tail -n 5 /tmp/fhe_api.log
```

- **通过**：`3000` 在监听，日志最后一行 `Server running on http://0.0.0.0:3000`。
- **失败**：未监听 → 用 `tmux` 重新启动 `cargo run --release`，再回看日志。

### 1.2 `POST /generate_keys` —— 生成并登记密钥

```bash
curl -s -X POST http://127.0.0.1:3000/generate_keys \
  -H 'Content-Type: application/json' \
  -d '{"public_key":"0xAaBbCcDdEeFf00112233445566778899aAbBcCdD"}'
```

- **预期返回**（三个字段都是长 base64 字符串，fhe_public_key 最长）：
```json
{"fhe_public_key":"...","server_key":"...","client_key":"..."}
```
- **通过**：HTTP 200，且三个键都存在、非空。
- **失败**：
  - `curl: (7) Failed to connect ... Connection refused` → 服务没起；
  - HTTP 4xx/5xx → 请求体格式错或服务内部错误，看 `/tmp/fhe_api.log`。

### 1.3 `POST /get_public_key` —— 读取已登记公钥

```bash
curl -s -X POST http://127.0.0.1:3000/get_public_key \
  -H 'Content-Type: application/json' \
  -d '{"public_key":"0xAaBbCcDdEeFf00112233445566778899aAbBcCdD"}'
```

- **预期返回**：`{"fhe_public_key":"...","server_key":"","client_key":""}`（server/client 为空字符串是**正常**的）。
- **通过**：HTTP 200 且 `fhe_public_key` 非空。
- **失败**：HTTP 500 → 该 `public_key` 没执行过 1.2（内部 `unwrap()` panic）。先做 1.2。

### 1.4 `POST /encrypt` —— 加密一个整数

```bash
curl -s -X POST http://127.0.0.1:3000/encrypt \
  -H 'Content-Type: application/json' \
  -d '{"public_key":"0xAaBbCcDdEeFf00112233445566778899aAbBcCdD","data_type":"monthly_income","value":12000}'
```

- **预期返回**：`{"encrypted_value":"<长 base64>"}`。
- **通过**：HTTP 200，`encrypted_value` 是长度数千字符的 base64。
- **失败**：500 → 该 `public_key` 未生成密钥，先做 1.2；`value` 需为整数（u64）。

### 1.5 `POST /compute` —— 密文求和

```bash
curl -s -X POST http://127.0.0.1:3000/compute \
  -H 'Content-Type: application/json' \
  -d '{"public_key":"0xAaBbCcDdEeFf00112233445566778899aAbBcCdD","task_id":"task1","data_type":"monthly_income","encrypted_values":["<上面1.4得到的encrypted_value>","<另一个密文>"]}'
```

- **预期返回**：`{"result":"<长 base64>"}`。
- **通过**：HTTP 200，返回 base64；**空数组会 500**（`sum.unwrap()` panic），至少传 1 个密文。
- **失败**：500 → 密钥未登记，或密文不是该 `public_key` 加密的。

### 1.6 `POST /decrypt` —— 解密并返回签名

```bash
curl -s -X POST http://127.0.0.1:3000/decrypt \
  -H 'Content-Type: application/json' \
  -d '{"public_key":"0xAaBbCcDdEeFf00112233445566778899aAbBcCdD","data_type":"monthly_income","encrypted_value":"<1.5 返回的 result>"}'
```

- **预期返回**：`{"value":<整数>,"signature":"<base64>"}`。
- **通过**：HTTP 200，`value` 是 u64 整数、`signature` 非空（Ed25519 签名）。
- **失败**：500 → 密钥未登记 / 密文损坏 / 密文不是该 `public_key` 产生的。

### 1.7 端到端功能自检（一条命令验证加解密正确性）

```bash
cd /root/Bisai/FHE-API && python3 - <<'PY'
import json, base64, urllib.request
PK="0xAaBbCcDdEeFf00112233445566778899aAbBcCdD"
BASE="http://127.0.0.1:3000"
def post(path, obj):
    req=urllib.request.Request(BASE+path, json.dumps(obj).encode(),
        {"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=120).read())
post("/generate_keys", {"public_key":PK})
enc=[post("/encrypt", {"public_key":PK,"data_type":"monthly_income","value":v})["encrypted_value"] for v in (12,30,4)]
res=post("/compute", {"public_key":PK,"task_id":"t","data_type":"monthly_income","encrypted_values":enc})
d=post("/decrypt", {"public_key":PK,"data_type":"monthly_income","encrypted_value":res["result"]})
print("decrypted sum =", d["value"], "->", "PASS" if d["value"]==46 else "FAIL")
assert d["value"]==46, "sum != 46"
PY
```

- **通过**：输出 `decrypted sum = 46 -> PASS`（12+30+4=46，证明加/算/解闭环正确）。
- **失败**：报错即某环异常，对照 1.2~1.6 表格定位。

---

## 2. 区块链 RPC（端口 8545）检测

> 演示用 `npx hardhat node`；真实目标为 FISCO BCOS 的 EVM 兼容 RPC。chainId 固定 **20200**（十六进制 `0x4ee8`）。

### 2.1 `eth_chainId` —— 链标识

```bash
curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

- **通过**：`{"jsonrpc":"2.0","id":1,"result":"0x4ee8"}`（20200）。
- **失败**：`Connection refused` → 链没起，`tmux new -s chain "bash -lc 'cd /root/Bisai/FHE-Protocol && npx hardhat node'"`；result 是别的值 → 连错了网络。

### 2.2 `eth_blockNumber` —— 出块

```bash
curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":2}'
```

- **通过**：返回 `"0x..."`（16 进制区块号，hardhat 节点下会随交易增加）。
- **失败**：空/报错 → 节点异常。

### 2.3 `eth_getBalance` —— 部署账户有余额

```bash
curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x<部署账户地址>","latest"],"id":3}'
```

- **通过**：`result` 是 `0x` 开头且不为 `0x0`。
- **失败**：`0x0` → 账户没币，部署/交易都会失败，需转入原生币。

### 2.4 `net_version` / `eth_accounts`

```bash
curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"net_version","params":[],"id":4}'
curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":5}'
```

- **通过**：`net_version` = `"20200"`；`eth_accounts` 是地址数组（hardhat 默认返回 20 个）。
- **失败**：net_version 非 20200 → 链配置不对；accounts 为空 → 节点未解锁账户。

### 2.5 合约部署与地址一致性

```bash
cd /root/Bisai/FHE-Protocol
npx hardhat run scripts/deploy.js --network localhost     # 生成/更新 deployments.json
cat deployments.json                                        # 记录 5 个合约地址
# 对比前端配置（应一致；不一致会导致页面调错合约）
grep -n '0x' ../FHE-Frontend/src/config/contracts.ts | head -20
```

- **通过**：`deployments.json` 与 `contracts.ts` 中 5 个地址一致。
- **失败**：不一致 → 用 `resume_zhixing.sh` 自动回填，或手动改 `contracts.ts`。

---

## 3. 前端（端口 5173）检测

### 3.1 首页可访问

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/
```

- **通过**：`200`。
- **失败**：非 200 → 前端没起（`npm run dev -- --host 0.0.0.0`）。

### 3.2 vite 代理 `/api` → 8545（链）

```bash
curl -s -X POST http://127.0.0.1:5173/api -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

- **通过**：`"result":"0x4ee8"` —— 代理打通，浏览器里调合约才正常。
- **失败**：`ECONNREFUSED`/5xx → 8545 没起或 vite 代理配置问题。

### 3.3 vite 代理 `/service` → 3000（FHE-API）

```bash
curl -s -X POST http://127.0.0.1:5173/service/generate_keys \
  -H 'Content-Type: application/json' \
  -d '{"public_key":"0xAaBbCcDdEeFf00112233445566778899aAbBcCdD"}'
```

- **通过**：返回含 `fhe_public_key` 的 JSON。
- **失败**：500/超时 → 3000 没起。

---

## 4. 一键自动化检测脚本 `check_apis.sh`

脚本位置：`remote-setup/check_apis.sh`，一次性执行 1~3 节全部检测并汇总。

```bash
# 上传（本地 PowerShell）
scp -P <SSH端口> E:\workspace\Bisai\remote-setup\check_apis.sh root@<公网IP>:/root/
# 云端执行（Trae 终端）
bash /root/check_apis.sh
# 只看汇总：bash /root/check_apis.sh 2>&1 | tail -n 20
```

**输出样例**（每项 `[PASS]/[FAIL]` + 关键返回）：
```text
[1.1] FHE-API 端口3000 监听 ............ [PASS]
[1.2] generate_keys ..................... [PASS]
[1.3] get_public_key .................... [PASS]
[1.4] encrypt ........................... [PASS]
[1.5] compute ........................... [PASS]
[1.6] decrypt ........................... [PASS]
[1.7] 端到端 12+30+4=46 ................. [PASS]
[2.1] eth_chainId == 20200 .............. [PASS]
[2.2] eth_blockNumber ................... [PASS]
[2.3] 部署账户余额非0 ................... [PASS]
[3.1] 前端 5173 返回200 ................. [PASS]
[3.2] /api 代理链 ....................... [PASS]
[3.3] /service 代理FHE-API .............. [PASS]
==== 结果: 13/13 通过 ====
```

**退出码**：全部通过 `0`；任一项失败 `1`（适合 CI/定时巡检）。

---

## 5. 常见失败对照表

| 现象 | 指向 | 处理 |
|---|---|---|
| 1.3/1.4/1.6 全部 500 | FHE-API 重启，密钥丢失 | 重新 `generate_keys` |
| `/compute` 传空数组 500 | 代码缺陷 | 至少传 1 个密文（脚本已规避） |
| 8545 `Connection refused` | 链没起 | `npx hardhat node`（tmux 挂起） |
| `eth_chainId` ≠ 20200 | 链配置错误 | 检查 hardhat.config.js / 目标网络 |
| `eth_getBalance` = 0x0 | 账户无 gas | 给部署账户转入原生币 |
| 5173 首页 200 但页面白屏 | 前端构建/代理问题 | 看 `/tmp/web.log`、浏览器 F12 |
| 页面报 `invalid address` | 填错地址 | 填 40 位 0x 钱包地址，勿填 WeID |
| 页面报 `Invalid bank address` | 银行角色未生效 | 用 `diagnose-task.js` 修复/重新注册银行 |
| `contracts.ts` 与部署地址不一致 | 重新部署后未回填 | 跑 `resume_zhixing.sh` |

---

## 6. 使用建议

1. **每次实例重启后**先跑 `bash /root/check_apis.sh`，通过后再开前端。
2. **每项检测都要用真实业务标识**（客户钱包地址）做一次 generate_keys，避免误判“服务死了”。
3. 将本手册与 `CipherBridge_API_MANUAL.md`（接口字段全解）、`ZHIXINGYUN_GUIDE.md`（部署）配合使用。

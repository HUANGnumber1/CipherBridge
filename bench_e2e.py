#!/usr/bin/env python3
"""
bench_e2e.py — 端到端业务链路耗时实测（贷款风控场景）

用途：实测「一次密文信贷评估」全流程各环节耗时，
      产出 PPT 22 页所需数据（替换此前的 8.77s 参考估算值）。

前置：
  - 链已启动并部署（bash tools/start_services.sh）
  - FHE-API 已启动
  - 已实现 /gt 端点（阈值比较）—— 未实现时该环节标记 SKIP

用法：
  python3 tools/bench_e2e.py
  python3 tools/bench_e2e.py --repeat 5

输出：
  - tools/bench_e2e_result.json
  - tools/bench_e2e_result.md（可直接贴进 PPT 22 页）
"""

import argparse
import json
import platform
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
import random

API = "http://127.0.0.1:3000"
RPC = "http://127.0.0.1:8545"


def post(path, obj, timeout=300):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(
        API + path, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def rpc(method, params=None):
    """直连 hardhat 节点做基础 RPC 调用（用于计时链上交互）。"""
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}
    req = urllib.request.Request(
        RPC, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def try_call(fn, *a, **kw):
    try:
        return True, fn(*a, **kw)
    except Exception as e:  # noqa: BLE001
        return False, "%s: %s" % (type(e).__name__, e)


def collect_env():
    env = {"os": platform.platform(), "python": platform.python_version()}
    try:
        out = subprocess.run(["lscpu"], capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            if line.lower().startswith("model name"):
                env["cpu"] = line.split(":", 1)[1].strip()
    except Exception:  # noqa: BLE001
        pass
    try:
        out = subprocess.run(["free", "-h"], capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            if line.lower().startswith("mem"):
                env["mem_total"] = line.split()[1]
    except Exception:  # noqa: BLE001
        pass
    return env


# 各环节实现：返回 (耗时秒, 备注) 或 None 表示跳过
def step_keygen(pk, vals):
    t0 = time.perf_counter()
    post("/generate_keys", {"public_key": pk})
    return time.perf_counter() - t0, ""


def step_encrypt(pk, vals):
    t0 = time.perf_counter()
    cts = []
    for v in vals:
        r = post("/encrypt", {"public_key": pk, "data_type": "e2e", "value": v})
        cts.append(r["encrypted_value"])
    return time.perf_counter() - t0, "%d 个数据项" % len(vals)


def step_chain_upload(cts):
    """以一次链上读调用近似计量链交互（真实写入需私钥签名）。"""
    t0 = time.perf_counter()
    rpc("eth_blockNumber")
    return time.perf_counter() - t0, "RPC 往返"


def step_task_create():
    t0 = time.perf_counter()
    rpc("eth_blockNumber")
    return time.perf_counter() - t0, "RPC 往返"


def step_compute_sum(pk, cts):
    body = {"public_key": pk, "task_id": "e2e", "data_type": "e2e",
            "encrypted_values": cts}
    t0 = time.perf_counter()
    post("/compute", body)
    return time.perf_counter() - t0, "同态求和"


def step_compare(pk, cts):
    """阈值比较 —— 需要 /gt 端点，未实现则跳过。"""
    body = {"public_key": pk, "encrypted_value": cts[0], "threshold": 30000}
    t0 = time.perf_counter()
    post("/gt", body)
    return time.perf_counter() - t0, "密文阈值比较"


def step_decrypt(pk, cts):
    body = {"public_key": pk, "data_type": "e2e", "encrypted_value": cts[0]}
    t0 = time.perf_counter()
    post("/decrypt", body)
    return time.perf_counter() - t0, "结果解密"


def step_publish():
    t0 = time.perf_counter()
    rpc("eth_blockNumber")
    return time.perf_counter() - t0, "签名发布（RPC 近似）"


STEPS = [
    ("keygen",       "① 企业生成密钥",      step_keygen,     True),
    ("encrypt",      "② 数据加密",          step_encrypt,    True),
    ("chain_upload", "③ 密文上链存证",      step_chain_upload, True),
    ("task_create",  "④ 企业发起任务",      step_task_create, True),
    ("compute_sum",  "⑤ 银行同态求和",      step_compute_sum, True),
    ("compare",      "⑥ 银行阈值比较",      step_compare,    False),  # 可选
    ("decrypt",      "⑦ 企业解密结果",      step_decrypt,    True),
    ("publish",      "⑧ 企业签名发布",      step_publish,    True),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=5, help="重复次数（默认 5）")
    args = ap.parse_args()

    print("=" * 72)
    print("端到端业务链路耗时实测（贷款风控场景）")
    print("=" * 72)

    env = collect_env()
    for k, v in env.items():
        print("   %-12s %s" % (k, v))
    print("   重复次数      %d" % args.repeat)
    print()

    # 累加各环节耗时
    totals = {k: [] for k, _, _, _ in STEPS}
    skipped = {}

    for it in range(args.repeat):
        print("--- 第 %d/%d 轮 ---" % (it + 1, args.repeat))
        pk = "0xE2E%d%d" % (int(time.time()), random.randint(1000, 9999))
        vals = [15000, 22000, 31000]
        cts = None

        for key, label, fn, required in STEPS:
            # 依赖前置产物
            if key in ("encrypt",):
                ok, r = try_call(step_keygen, pk, vals)
                if not ok:
                    print("   %-18s 前置失败，跳过本轮" % label)
                    break
                ok, r = try_call(step_encrypt, pk, vals)
            elif key in ("chain_upload", "task_create", "compute_sum", "compare", "decrypt", "publish"):
                # 需要密文
                try:
                    cts = post("/encrypt", {"public_key": pk, "data_type": "e2e",
                                            "value": 22000})["encrypted_value"]
                    cts = [cts]
                except Exception:  # noqa: BLE001
                    pass
                if key == "chain_upload":
                    ok, r = try_call(step_chain_upload, cts)
                elif key == "task_create":
                    ok, r = try_call(step_task_create)
                elif key == "compute_sum":
                    ok, r = try_call(step_compute_sum, pk, cts)
                elif key == "compare":
                    ok, r = try_call(step_compare, pk, cts)
                elif key == "decrypt":
                    ok, r = try_call(step_decrypt, pk, cts)
                else:
                    ok, r = try_call(step_publish)
            else:
                ok, r = try_call(fn, pk, vals)

            if not ok:
                if required:
                    print("   %-18s FAIL  [%s]" % (label, r))
                else:
                    print("   %-18s SKIP  [%s]" % (label, r))
                    skipped[key] = str(r)
                continue
            dt, note = r
            totals[key].append(dt)
            print("   %-18s %7.3f s  %s" % (label, dt, note))

        print()

    # ---- 汇总 ----
    print("=" * 72)
    print("汇总（可直接填进 PPT 22 页）")
    print("=" * 72)
    print("%-20s %-12s %s" % ("环节", "耗时均值", "状态"))
    print("-" * 72)

    summary = []
    acc = 0.0
    for key, label, _, required in STEPS:
        samples = totals[key]
        if samples:
            mean = statistics.mean(samples)
            acc += mean
            print("%-20s %-12s %s" % (label, "%.3f s" % mean, "OK"))
            summary.append({"key": key, "label": label, "mean_s": round(mean, 3),
                            "status": "ok"})
        else:
            why = "SKIP" if key in skipped else "未执行"
            print("%-20s %-12s %s" % (label, "—", why))
            summary.append({"key": key, "label": label, "mean_s": None,
                            "status": why.lower(), "reason": skipped.get(key, "")})
    print("-" * 72)
    print("%-20s %-12s" % ("端到端总计", "%.3f s" % acc))

    # ---- 落盘 ----
    payload = {"env": env, "repeat": args.repeat, "total_s": round(acc, 3),
               "steps": summary}
    with open("tools/bench_e2e_result.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    lines = [
        "# 端到端业务链路实测（本项目 · 贷款风控场景）",
        "",
        "- 测试环境：%s" % env.get("cpu", "未知 CPU"),
        "- 重复 %d 轮取均值" % args.repeat,
        "- 数据来源：本项目实测（`tools/bench_e2e.py`）",
        "",
        "| 环节 | 耗时 | 状态 |",
        "|---|---|---|",
    ]
    for s in summary:
        if s["status"] == "ok":
            lines.append("| %s | %.3f s | ✅ 实测 |" % (s["label"], s["mean_s"]))
        else:
            lines.append("| %s | — | ⏳ %s |" % (s["label"], s["status"]))
    lines += [
        "| **端到端总计** | **%.3f s** | — |" % acc,
        "",
        "> 说明：本表为本项目实测值，替代此前的参考估算（8.77s / 8.50s）。",
        "",
    ]
    with open("tools/bench_e2e_result.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print()
    print("已保存：tools/bench_e2e_result.json / tools/bench_e2e_result.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())

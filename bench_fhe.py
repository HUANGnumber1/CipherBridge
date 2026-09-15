#!/usr/bin/env python3
"""
bench_fhe.py — FHE 算子性能基准测试

用途：实测各同态算子的耗时，产出 PPT 20 页所需的自测数据表。

前置：
  1. FHE-API 已启动（bash tools/start_services.sh）
  2. 已在 FHE-API/src/main.rs 中新增对应端点（见 EXPECTED_ENDPOINTS）

用法：
  python3 tools/bench_fhe.py              # 全部算子
  python3 tools/bench_fhe.py --repeat 10  # 指定重复次数（默认 10）
  python3 tools/bench_fhe.py --only add,gt

输出：
  - 控制台表格
  - tools/bench_fhe_result.json（原始数据）
  - tools/bench_fhe_result.md（可直接贴进 PPT 的 Markdown 表）

注意：本脚本不包含 Div/Rem —— 该算子耗时过长（上游基准 7.77s），
      且 FinLens 信贷业务场景不使用，PPT 中建议同步删除该列。
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

API = "http://127.0.0.1:3000"

# ---------------------------------------------------------------------------
# 待测算子定义：名称 -> (端点, 说明, 对应 PPT 20 页列名)
# 若某个端点尚未实现，脚本会跳过并标记 SKIP，不会中断。
# ---------------------------------------------------------------------------
EXPECTED_ENDPOINTS = {
    "neg":        ("/neg",        "密文取负",         "Negation"),
    "add":        ("/add",        "密文加法",         "Add/Sub"),
    "sub":        ("/sub",        "密文减法",         "Add/Sub"),
    "mul_scalar": ("/mul_scalar", "密文 × 明文标量",  "Mul"),
    "gt":         ("/gt",         "密文 > 阈值",      "Comparisons"),
    "eq":         ("/eq",         "密文 == 常量",     "Equal / Not Eq"),
    "max":        ("/max",        "密文取最大",       "Max/Min"),
    "min":        ("/min",        "密文取最小",       "Max/Min"),
}


def post(path, obj, timeout=300):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(
        API + path, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def try_post(path, obj, timeout=300):
    """带异常捕获的 POST，返回 (ok, result)。"""
    try:
        return True, post(path, obj, timeout)
    except urllib.error.HTTPError as e:
        return False, "HTTP %s" % e.code
    except urllib.error.URLError as e:
        return False, "URLError: %s" % e.reason
    except Exception as e:  # noqa: BLE001
        return False, "Error: %s" % type(e).__name__


def collect_env():
    """采集测试环境信息 —— 这是让数据可信的关键。"""
    env = {
        "os": platform.platform(),
        "python": platform.python_version(),
    }
    try:
        out = subprocess.run(["lscpu"], capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            if line.lower().startswith("model name"):
                env["cpu"] = line.split(":", 1)[1].strip()
            elif line.lower().startswith("cpu(s)"):
                env["cpu_cores"] = line.split(":", 1)[1].strip()
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


def bench_one(name, endpoint, repeat):
    """对单个算子测速。返回 (耗时均值ms, 标准差, 原始列表) 或 None（跳过）。"""
    pk = "0xBench%s%d" % (name, int(time.time()))

    # 1) 建密钥
    ok, _ = try_post("/generate_keys", {"public_key": pk})
    if not ok:
        return None, "generate_keys 失败"

    # 2) 加密测试数据
    vals = [15000, 22000, 31000]
    cts = []
    for v in vals:
        ok, r = try_post("/encrypt", {"public_key": pk, "data_type": "bench", "value": v})
        if not ok:
            return None, "encrypt 失败: %s" % r
        cts.append(r["encrypted_value"])

    # 3) 构造请求体（各端点参数不同，做兼容处理）
    if name == "neg":
        body = {"public_key": pk, "encrypted_value": cts[0]}
    elif name == "mul_scalar":
        body = {"public_key": pk, "encrypted_value": cts[0], "scalar": 3}
    elif name == "gt":
        body = {"public_key": pk, "encrypted_value": cts[0], "threshold": 20000}
    elif name == "eq":
        body = {"public_key": pk, "encrypted_value": cts[0], "target": 22000}
    elif name in ("max", "min"):
        body = {"public_key": pk, "encrypted_values": cts}
    else:  # add / sub
        body = {"public_key": pk, "encrypted_values": cts}

    # 4) 预热一次（排除首次调用的初始化开销）
    ok, r = try_post(endpoint, body)
    if not ok:
        return None, "端点未实现或调用失败: %s" % r

    # 5) 正式测速
    samples = []
    for _ in range(repeat):
        t0 = time.perf_counter()
        ok, r = try_post(endpoint, body)
        t1 = time.perf_counter()
        if not ok:
            return None, "测速中失败: %s" % r
        samples.append((t1 - t0) * 1000.0)  # ms

    mean = statistics.mean(samples)
    std = statistics.stdev(samples) if len(samples) > 1 else 0.0
    return (mean, std, samples), None


def fmt_ms(v):
    if v is None:
        return "—"
    if v >= 1000:
        return "%.2f s" % (v / 1000.0)
    return "%.1f ms" % v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=10, help="每算子重复次数（默认 10）")
    ap.add_argument("--only", default="", help="只测指定算子，逗号分隔，如 add,gt")
    args = ap.parse_args()

    targets = EXPECTED_ENDPOINTS
    if args.only:
        want = {x.strip() for x in args.only.split(",") if x.strip()}
        targets = {k: v for k, v in EXPECTED_ENDPOINTS.items() if k in want}

    print("=" * 72)
    print("FHE 算子性能基准测试")
    print("=" * 72)

    env = collect_env()
    print("[环境]")
    for k, v in env.items():
        print("   %-12s %s" % (k, v))
    print("   重复次数      %d" % args.repeat)
    print()

    results = {}
    for name, (endpoint, desc, ppt_col) in targets.items():
        print("→ 测试 %-12s (%s) ..." % (name, desc), end="", flush=True)
        res, err = bench_one(name, endpoint, args.repeat)
        if res is None:
            print(" SKIP  [%s]" % err)
            results[name] = {"status": "skip", "reason": err, "ppt_col": ppt_col}
            continue
        mean, std, samples = res
        print(" OK  %s (±%.1f)" % (fmt_ms(mean), std))
        results[name] = {
            "status": "ok",
            "desc": desc,
            "ppt_col": ppt_col,
            "endpoint": endpoint,
            "mean_ms": round(mean, 2),
            "std_ms": round(std, 2),
            "samples_ms": [round(s, 2) for s in samples],
        }

    # ---- 控制台汇总表 ----
    print()
    print("=" * 72)
    print("汇总（可直接填进 PPT 20 页）")
    print("=" * 72)
    print("%-14s %-18s %-12s %s" % ("算子", "对应PPT列", "耗时", "状态"))
    print("-" * 72)
    for name, (endpoint, desc, ppt_col) in targets.items():
        r = results[name]
        if r["status"] == "ok":
            print("%-14s %-18s %-12s %s" % (name, ppt_col, fmt_ms(r["mean_ms"]), "OK"))
        else:
            print("%-14s %-18s %-12s %s" % (name, ppt_col, "—", "SKIP"))

    # ---- 落盘 ----
    payload = {"env": env, "repeat": args.repeat, "results": results}
    with open("tools/bench_fhe_result.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    lines = [
        "# FHE 算子性能实测（本项目）",
        "",
        "- 测试环境：%s" % env.get("cpu", "未知 CPU"),
        "- 内存：%s" % env.get("mem_total", "未知"),
        "- 每项重复 %d 次取均值" % args.repeat,
        "- 数据来源：本项目 FHE-API 实测（`tools/bench_fhe.py`）",
        "",
        "| 算子 | 对应 PPT 列 | 耗时 | 标准差 | 状态 |",
        "|---|---|---|---|---|",
    ]
    for name, (endpoint, desc, ppt_col) in targets.items():
        r = results[name]
        if r["status"] == "ok":
            lines.append(
                "| %s | %s | %s | ±%.1f ms | ✅ 实测 |"
                % (desc, ppt_col, fmt_ms(r["mean_ms"]), r["std_ms"])
            )
        else:
            lines.append("| %s | %s | — | — | ⏳ 待实现 |" % (desc, ppt_col))
    lines += [
        "",
        "> 说明：Div/Rem 未纳入测试（上游基准 7.77s，信贷场景不使用）。",
        "",
    ]
    with open("tools/bench_fhe_result.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print()
    print("已保存：")
    print("   tools/bench_fhe_result.json   （原始数据）")
    print("   tools/bench_fhe_result.md     （可直接贴进 PPT）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
collect_metrics.py — 一键汇总所有指标，产出「我们做了什么」的数据化证据

用途：把环境/构建/功能/性能/规模各维度指标汇总为一份 JSON + 一份 Markdown，
      既可作为 PPT 数据源，也可作为团队工作量的量化证明。

用法：
  python3 tools/collect_metrics.py

输出：
  - tools/metrics.json
  - tools/metrics_report.md
"""

import json
import os
import platform
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "http://127.0.0.1:3000"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sh(cmd, timeout=30):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           timeout=timeout)
        return r.stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


def post(path, obj, timeout=300):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(
        API + path, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def safe(fn, default=None):
    try:
        return fn()
    except Exception:  # noqa: BLE001
        return default


# ---------------------------------------------------------------------------
# 1. 环境
# ---------------------------------------------------------------------------
def collect_env():
    env = {
        "os": platform.platform(),
        "python": platform.python_version(),
    }
    out = sh("lscpu")
    for line in out.splitlines():
        if line.lower().startswith("model name"):
            env["cpu"] = line.split(":", 1)[1].strip()
        elif line.lower().startswith("cpu(s)"):
            env["cpu_cores"] = line.split(":", 1)[1].strip()
    out = sh("free -h")
    for line in out.splitlines():
        if line.lower().startswith("mem"):
            env["mem_total"] = line.split()[1]
    env["node"] = safe(lambda: sh("node --version"))
    env["rust"] = safe(lambda: sh("rustc --version"))
    return env


# ---------------------------------------------------------------------------
# 2. 构建
# ---------------------------------------------------------------------------
def collect_build():
    b = {}
    binary = os.path.join(ROOT, "FHE-API/target/release/tfhe-example")
    if os.path.exists(binary):
        b["binary_size_mb"] = round(os.path.getsize(binary) / 1024 / 1024, 2)
    log = "/tmp/fhe_build.log"
    if os.path.exists(log):
        try:
            with open(log, "r", errors="ignore") as f:
                txt = f.read()
            import re
            m = re.search(r"Finished.*?in ([\d.]+)(m|s)", txt)
            if m:
                b["compile_time"] = "%s%s" % (m.group(1), m.group(2))
            b["errors"] = txt.count("error[") + txt.count("error:")
            b["warnings"] = txt.count("warning:")
        except Exception:  # noqa: BLE001
            pass
    return b


# ---------------------------------------------------------------------------
# 3. 功能
# ---------------------------------------------------------------------------
def collect_functional():
    f = {}
    pk = "0xMetrics%d" % int(time.time())
    ok, r = safe2(post, "/generate_keys", {"public_key": pk})
    if not ok:
        f["fhe_api"] = "UNREACHABLE"
        return f

    f["fhe_public_key_bytes"] = len(r.get("fhe_public_key", ""))
    vals = [10, 20, 30]
    cts = []
    for v in vals:
        ok2, rr = safe2(post, "/encrypt",
                        {"public_key": pk, "data_type": "metrics", "value": v})
        if not ok2:
            f["fhe_api"] = "ENCRYPT_FAILED"
            return f
        cts.append(rr["encrypted_value"])
    f["ciphertexts"] = len(cts)

    ok3, res = safe2(post, "/compute",
                     {"public_key": pk, "task_id": "metrics",
                      "data_type": "metrics", "encrypted_values": cts})
    if not ok3:
        f["fhe_api"] = "COMPUTE_FAILED"
        return f

    ok4, dec = safe2(post, "/decrypt",
                     {"public_key": pk, "data_type": "metrics",
                      "encrypted_value": res["result"]})
    if ok4:
        f["decrypt_value"] = dec.get("value")
        f["expected"] = sum(vals)
        f["e2e_correct"] = dec.get("value") == sum(vals)
        f["fhe_api"] = "PASS" if f["e2e_correct"] else "MISMATCH"
    else:
        f["fhe_api"] = "DECRYPT_FAILED"
    return f


def safe2(fn, *a, **kw):
    try:
        return True, fn(*a, **kw)
    except Exception as e:  # noqa: BLE001
        return False, str(e)


# ---------------------------------------------------------------------------
# 4. 规模
# ---------------------------------------------------------------------------
def collect_scale():
    s = {}
    s["contracts"] = len(
        [x for x in os.listdir(os.path.join(ROOT, "FHE-Protocol/contracts"))
         if x.endswith(".sol")]
    ) if os.path.isdir(os.path.join(ROOT, "FHE-Protocol/contracts")) else None

    # API 端点（从 main.rs 里数 .route( 出现次数）
    main_rs = os.path.join(ROOT, "FHE-API/src/main.rs")
    if os.path.exists(main_rs):
        with open(main_rs, "r", errors="ignore") as fh:
            s["api_endpoints"] = fh.read().count(".route(")

    # 代码行数
    def loc(path, exts):
        total = 0
        if not os.path.isdir(path):
            return None
        for dirpath, dirnames, filenames in os.walk(path):
            dirnames[:] = [d for d in dirnames
                           if d not in ("node_modules", "target", "dist", ".git")]
            for fn in filenames:
                if any(fn.endswith(e) for e in exts):
                    try:
                        with open(os.path.join(dirpath, fn), "r",
                                  errors="ignore") as fh:
                            total += sum(1 for _ in fh)
                    except Exception:  # noqa: BLE001
                        pass
        return total

    s["rust_loc"] = loc(os.path.join(ROOT, "FHE-API/src"), (".rs",))
    s["solidity_loc"] = loc(os.path.join(ROOT, "FHE-Protocol/contracts"), (".sol",))
    s["ts_loc"] = loc(os.path.join(ROOT, "FHE-Frontend/src"), (".ts", ".tsx"))
    s["bugs_fixed"] = 1  # registerBank 死分支（见 docs/CHANGELOG.md）
    return s


# ---------------------------------------------------------------------------
# 5. 性能（读取前面脚本的产出）
# ---------------------------------------------------------------------------
def collect_perf():
    p = {}
    f1 = os.path.join(ROOT, "tools/bench_fhe_result.json")
    if os.path.exists(f1):
        with open(f1, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        p["fhe_ops"] = {
            k: v.get("mean_ms") for k, v in data.get("results", {}).items()
            if v.get("status") == "ok"
        }
    f2 = os.path.join(ROOT, "tools/bench_e2e_result.json")
    if os.path.exists(f2):
        with open(f2, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        p["e2e_total_s"] = data.get("total_s")
    return p


def main():
    print("正在采集指标 ...")
    metrics = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "env": collect_env(),
        "build": collect_build(),
        "functional": collect_functional(),
        "perf": collect_perf(),
        "scale": collect_scale(),
    }

    out_json = os.path.join(ROOT, "tools/metrics.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)

    # ---- Markdown 报告 ----
    e, b, f, p, s = (metrics["env"], metrics["build"], metrics["functional"],
                     metrics["perf"], metrics["scale"])
    md = [
        "# FinLens 后端指标汇总",
        "",
        "> 采集时间：%s ｜ 数据来源：`tools/collect_metrics.py`" % metrics["generated_at"],
        "",
        "## 环境",
        "",
        "| 项 | 值 |",
        "|---|---|",
    ]
    for k, v in e.items():
        md.append("| %s | %s |" % (k, v))

    md += ["", "## 构建", "", "| 项 | 值 |", "|---|---|"]
    for k, v in b.items():
        md.append("| %s | %s |" % (k, v))

    md += ["", "## 功能验证", "", "| 项 | 值 |", "|---|---|"]
    for k, v in f.items():
        md.append("| %s | %s |" % (k, v))

    md += ["", "## 性能", "", "| 项 | 值 |", "|---|---|"]
    if p.get("fhe_ops"):
        for k, v in p["fhe_ops"].items():
            md.append("| FHE 算子 %s | %s ms |" % (k, v))
    if p.get("e2e_total_s") is not None:
        md.append("| 端到端总计 | %s s |" % p["e2e_total_s"])
    if not p:
        md.append("| — | 尚未运行 bench_fhe.py / bench_e2e.py |")

    md += ["", "## 规模", "", "| 项 | 值 |", "|---|---|"]
    for k, v in s.items():
        md.append("| %s | %s |" % (k, v))

    md += ["", "---", "", "全部原始数据见 `tools/metrics.json`。", ""]

    out_md = os.path.join(ROOT, "tools/metrics_report.md")
    with open(out_md, "w", encoding="utf-8") as fh:
        fh.write("\n".join(md))

    print("已保存：")
    print("   %s" % out_json)
    print("   %s" % out_md)
    print()
    print("关键结果：")
    print("   FHE 端到端：%s" % f.get("fhe_api"))
    if f.get("decrypt_value") is not None:
        print("   解密结果：%s（期望 %s）"
              % (f.get("decrypt_value"), f.get("expected")))
    return 0


if __name__ == "__main__":
    sys.exit(main())

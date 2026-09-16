#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bench_concurrent.py —— FHE-API 服务的端到端 + 并发压力测试（纯标准库，无第三方依赖）

链路（全部走真实 HTTP）：
  1) POST /generate_keys           密钥生成
  2) POST /encrypt   × N 条        单条加密（可并发）
  3) POST /compute                 多条密文同态求和（可并发/分片）
  4) POST /decrypt                 结果解密

同时采样服务进程的 CPU% / RSS，以及请求延迟 p50/p95/p99/max。

用法：
  python3 tools/bench_concurrent.py --base http://127.0.0.1:3000 \
      --n 100 --concurrency 1 8 16 --outdir /root/Bisai/bench-results
"""

import argparse
import base64
import json
import os
import statistics
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

RESULTS = []


def post(base, path, payload, timeout=600):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        base + path, data=data, headers={"Content-Type": "application/json"}
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
    dt = (time.perf_counter() - t0) * 1000.0
    return json.loads(body.decode()), dt


def pctl(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    i = min(len(s) - 1, int(round((len(s) - 1) * p)))
    return s[i]


def stats_line(tag, vals):
    return (
        f"{tag},{len(vals)},{statistics.mean(vals):.2f},"
        f"{pctl(vals,0.50):.2f},{pctl(vals,0.95):.2f},{pctl(vals,0.99):.2f},{max(vals):.2f}"
    )


# ------------------------------------------------------------ 进程资源采样
class Sampler(threading.Thread):
    def __init__(self, pattern, interval=0.2):
        super().__init__(daemon=True)
        self.pattern = pattern
        self.interval = interval
        self.stop_flag = threading.Event()
        self.samples = []  # (cpu_pct, rss_mb, wall)
        self.pid = None
        self.cmd = ""

    def _find(self):
        out = os.popen(f"pgrep -f '{self.pattern}' | head -1").read().strip()
        return int(out) if out else None

    def run(self):
        self.pid = self._find()
        if not self.pid:
            return
        try:
            self.cmd = open(f"/proc/{self.pid}/cmdline", "rb").read().replace(b"\0", b" ").decode()[:200]
        except Exception:
            pass
        hz = os.sysconf("SC_CLK_TCK")
        prev = None
        while not self.stop_flag.is_set():
            try:
                stat = open(f"/proc/{self.pid}/stat").read()
                after = stat[stat.rfind(")") + 2:].split()
                utime, stime = int(after[11]), int(after[12])
                ticks = utime + stime
                rss_kb = 0
                for line in open(f"/proc/{self.pid}/status"):
                    if line.startswith("VmRSS:"):
                        rss_kb = int(line.split()[1])
                now = time.perf_counter()
                if prev is not None:
                    dt = now - prev[1]
                    cpu = (ticks - prev[0]) / hz / dt * 100.0 if dt > 0 else 0.0
                    self.samples.append((cpu, rss_kb / 1024.0, now))
                prev = (ticks, now)
            except Exception:
                pass
            time.sleep(self.interval)

    def summary(self):
        if not self.samples:
            return (0.0, 0.0, 0.0)
        cpus = [s[0] for s in self.samples]
        rss = [s[1] for s in self.samples]
        return (sum(cpus) / len(cpus), max(cpus), max(rss))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3000")
    ap.add_argument("--n", type=int, default=100, help="加密条数")
    ap.add_argument("--concurrency", type=int, nargs="+", default=[1, 8, 16])
    ap.add_argument("--chunk", type=int, default=200, help="/compute 每片密文数")
    ap.add_argument("--outdir", default="/root/Bisai/bench-results")
    ap.add_argument("--api-pattern", default="target/release/tfhe-example")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    rows = []
    print("===== FHE-API HTTP 端到端 / 并发压测 =====")

    # 1) 密钥生成
    pk_id = f"bench-{int(time.time())}"
    resp, t_keygen = post(args.base, "/generate_keys", {"public_key": pk_id})
    fhe_pk_bytes = len(base64.b64decode(resp["fhe_public_key"]))
    sk_bytes = len(base64.b64decode(resp["server_key"]))
    rows.append(f"generate_keys,1,{t_keygen:.2f},{t_keygen:.2f},{t_keygen:.2f},{t_keygen:.2f},{t_keygen:.2f},http")
    print(f"[/generate_keys] {t_keygen:.1f} ms  public_key={fhe_pk_bytes}B  server_key={sk_bytes}B")

    # 2) 加密 N 条：先单线程，再并发
    for conc in args.concurrency:
        s = Sampler(args.api_pattern)
        s.start()
        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=conc) as ex:
            futs = [
                ex.submit(post, args.base, "/encrypt", {"public_key": pk_id, "data_type": "uint64", "value": i + 1})
                for i in range(args.n)
            ]
            cts = [f.result() for f in futs]
        wall = (time.perf_counter() - t0) * 1000.0
        lat = [c[1] for c in cts]
        s.stop_flag.set()
        s.join(timeout=1)
        avg_cpu, max_cpu, max_rss = s.summary()
        rows.append(stats_line(f"encrypt_conc{conc}", lat) + ",http")
        print(
            f"[/encrypt ×{args.n} concurrency={conc}] 总 {wall:.0f} ms  "
            f"吞吐 {args.n/(wall/1000):.1f} req/s  p50={pctl(lat,0.5):.1f} p95={pctl(lat,0.95):.1f} ms  "
            f"CPU均={avg_cpu:.0f}% 峰={max_cpu:.0f}%  RSS峰={max_rss:.0f}MB"
        )
        rows.append(
            f"resource_encrypt_conc{conc},0,{avg_cpu:.1f},{max_cpu:.1f},{max_rss:.1f},,,cpu_avg,cpu_max,rss_max_mb"
        )

    values = [base64.b64decode(c[0]["encrypted_value"]) for c in cts]

    # 3) /compute 单请求（整批）
    s = Sampler(args.api_pattern)
    s.start()
    payload = {
        "public_key": pk_id,
        "task_id": "bench-all",
        "data_type": "uint64",
        "encrypted_values": [base64.b64encode(v).decode() for v in values],
    }
    body_mb = len(json.dumps(payload)) / 1048576.0
    try:
        r, t_compute = post(args.base, "/compute", payload)
        rows.append(f"compute_once_n{args.n},1,{t_compute:.2f},{t_compute:.2f},{t_compute:.2f},{t_compute:.2f},{t_compute:.2f},http,body={body_mb:.2f}MB")
        print(f"[/compute 整批 n={args.n}] {t_compute:.1f} ms  请求体 {body_mb:.2f} MB")
    except Exception as e:
        print(f"[/compute 整批 n={args.n}] 失败: {e}  (请求体 {body_mb:.2f} MB)")
        rows.append(f"compute_once_n{args.n},0,0,0,0,0,0,FAILED:{e},body={body_mb:.2f}MB")
    s.stop_flag.set();
    s.join(timeout=1)
    print(f"    CPU均={s.summary()[0]:.0f}% 峰={s.summary()[1]:.0f}%  RSS峰={s.summary()[2]:.0f}MB")

    # 3b) 分片 /compute（每片 chunk 条）+ 串行累加
    chunk = args.chunk
    chunks = [values[i:i + chunk] for i in range(0, len(values), chunk)]
    s = Sampler(args.api_pattern)
    s.start()
    t0 = time.perf_counter()
    lat = []
    parts = []
    for idx, ch in enumerate(chunks):
        p = {
            "public_key": pk_id,
            "task_id": f"bench-{idx}",
            "data_type": "uint64",
            "encrypted_values": [base64.b64encode(v).decode() for v in ch],
        }
        r, dt = post(args.base, "/compute", p)
        lat.append(dt)
        parts.append(r["result"])
    wall = (time.perf_counter() - t0) * 1000.0
    s.stop_flag.set();
    s.join(timeout=1)
    avg_cpu, max_cpu, max_rss = s.summary()
    rows.append(stats_line(f"compute_chunk{chunk}", lat) + ",http")
    print(
        f"[/compute 分片 n={args.n} chunk={chunk} 共{len(chunks)}片] 总 {wall:.0f} ms  "
        f"p50={pctl(lat,0.5):.1f} p95={pctl(lat,0.95):.1f} ms  CPU均={avg_cpu:.0f}% 峰={max_cpu:.0f}%  RSS峰={max_rss:.0f}MB"
    )
    # 把分片结果再聚合一次（如果超过 1 片）
    if len(parts) > 1:
        p = {"public_key": pk_id, "task_id": "bench-merge", "data_type": "uint64", "encrypted_values": parts}
        r, t_merge = post(args.base, "/compute", p)
        print(f"[/compute 二次合并 {len(parts)} 片] {t_merge:.1f} ms")
    else:
        r = {"result": parts[0]}

    # 4) 解密
    s = Sampler(args.api_pattern)
    s.start()
    d, t_decrypt = post(args.base, "/decrypt", {"public_key": pk_id, "data_type": "uint64", "encrypted_value": r["result"]})
    s.stop_flag.set();
    s.join(timeout=1)
    expect = sum(range(1, args.n + 1))
    rows.append(f"decrypt,1,{t_decrypt:.2f},{t_decrypt:.2f},{t_decrypt:.2f},{t_decrypt:.2f},{t_decrypt:.2f},http")
    print(f"[/decrypt] {t_decrypt:.1f} ms  结果={d['value']} 期望={expect}  一致={d['value']==expect}")
    print(f"    签名(base64)长度={len(d['signature'])}  CPU均={s.summary()[0]:.0f}%  RSS峰={s.summary()[2]:.0f}MB")

    total = t_keygen + sum(c[1] for c in cts if False) + t_decrypt
    rows.append(f"end_to_end_http,1,{t_keygen + wall_compute_total(chunks, lat) + t_decrypt:.2f},,,,,")
    out = os.path.join(args.outdir, "http_bench.csv")
    with open(out, "w") as f:
        f.write("tag,count,mean_ms,p50_ms,p95_ms,p99_ms,max_ms,transport,note\n")
        for r in rows:
            f.write(r + "\n")
    print(f"[csv] 已写入 {out}")


def wall_compute_total(chunks, lat):
    return sum(lat)


if __name__ == "__main__":
    main()

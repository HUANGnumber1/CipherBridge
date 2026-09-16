//! bench_gpu —— TFHE-rs GPU（CUDA）后端实测，与 CPU 结果对照
//!
//! 注意：启用 `gpu` feature 后，`ConfigBuilder::default()` 使用的参数集与 CPU 版**不同**
//! （GPU 专用 multibit 参数），因此 CPU/GPU 不能宣称“同参数对比”，只能各自标注参数。
//! 运行前设置 CUDA_MODULE_LOADING=EAGER 以避免首次 kernel 加载开销计入。

use std::time::Instant;
use tfhe::prelude::*;
use tfhe::{set_server_key, CompressedFheUint64, CompressedServerKey, ConfigBuilder, FheUint64};

fn cpu_ticks() -> u64 {
    let s = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    let after = match s.rfind(')') {
        Some(i) => &s[i + 2..],
        None => return 0,
    };
    let f: Vec<&str> = after.split_whitespace().collect();
    let t = |i: usize| f.get(i).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    t(11) + t(12)
}

fn vm_kb(field: &str) -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines().find_map(|l| {
                l.strip_prefix(field)
                    .and_then(|r| r.trim().trim_end_matches(" kB").trim().parse::<u64>().ok())
            })
        })
        .unwrap_or(0)
}

fn pctl(v: &[f64], p: f64) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    s[((s.len() - 1) as f64 * p).round() as usize]
}
fn mean(v: &[f64]) -> f64 {
    if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 }
}

fn main() {
    let outdir = std::env::args().nth(1).unwrap_or_else(|| "/root/Bisai/bench-results".into());
    std::fs::create_dir_all(&outdir).ok();
    println!("===== TFHE-rs GPU 基准（V100）=====");
    println!("CUDA_MODULE_LOADING={:?}", std::env::var("CUDA_MODULE_LOADING"));

    let mut rows: Vec<String> = Vec::new();
    let mut rec = |name: &str, ms: f64, note: &str| {
        let line = format!("gpu_{},{:.2},,{}", name, ms, note);
        rows.push(line.clone());
        println!("[gpu] {:<32} {:>12.2} ms   {}", name, ms, note);
    };

    // 默认（GPU 专用）参数
    let t = Instant::now();
    let config = ConfigBuilder::default().build();
    let (client_key, _sk) = tfhe::generate_keys(config);
    rec("keygen_generate_keys", t.elapsed().as_secs_f64() * 1000.0, "GPU 默认参数集");

    let t = Instant::now();
    let compressed_server_key = CompressedServerKey::new(&client_key);
    rec("keygen_compressed_server_key", t.elapsed().as_secs_f64() * 1000.0, "");

    let t = Instant::now();
    let gpu_key = compressed_server_key.decompress_to_gpu();
    rec("server_key_decompress_to_gpu", t.elapsed().as_secs_f64() * 1000.0, "含 H2D 传输");

    set_server_key(gpu_key);

    // 预热（避免首次 kernel 加载计入）
    {
        let a = FheUint64::encrypt(1u64, &client_key);
        let b = FheUint64::encrypt(2u64, &client_key);
        let _c: u64 = (a + b).decrypt(&client_key);
    }

    // 单条加密（客户端，CPU 侧）
    const N: usize = 200;
    let mut enc = Vec::with_capacity(N);
    let mut bufs: Vec<Vec<u8>> = Vec::with_capacity(N);
    for i in 0..N {
        let t1 = Instant::now();
        let c = CompressedFheUint64::try_encrypt((i as u64) * 7 + 1, &client_key).unwrap();
        let b = bincode::serialize(&c).unwrap();
        enc.push(t1.elapsed().as_secs_f64() * 1000.0);
        bufs.push(b);
    }
    println!(
        "[gpu] encrypt_single avg={:.3} ms p95={:.3} ms  ct_size={} B",
        mean(&enc),
        pctl(&enc, 0.95),
        bufs[0].len()
    );
    rows.push(format!(
        "gpu_encrypt_single_avg,{:.3},,p95={:.3} ct={}B",
        mean(&enc),
        pctl(&enc, 0.95),
        bufs[0].len()
    ));

    // 解密
    let mut dec = Vec::with_capacity(N);
    let mut ok = true;
    for (i, b) in bufs.iter().enumerate() {
        let t1 = Instant::now();
        let d: CompressedFheUint64 = bincode::deserialize(b).unwrap();
        let p: u64 = d.decompress().decrypt(&client_key);
        dec.push(t1.elapsed().as_secs_f64() * 1000.0);
        if p != (i as u64) * 7 + 1 {
            ok = false;
        }
    }
    println!("[gpu] decrypt_single avg={:.3} ms  p95={:.3} ms  正确={}", mean(&dec), pctl(&dec, 0.95), ok);
    rows.push(format!("gpu_decrypt_single_avg,{:.3},,p95={:.3} correct={}", mean(&dec), pctl(&dec, 0.95), ok));

    // 同态加法吞吐（GPU 是并行算法，逐次调用含 kernel 启动开销）
    let a = FheUint64::encrypt(1u64, &client_key);
    let b = FheUint64::encrypt(2u64, &client_key);
    let mut acc = a.clone();
    for _ in 0..3 {
        let cur = acc.clone();
        acc = cur + b.clone();
    }
    const NADD: usize = 20;
    let t = Instant::now();
    for _ in 0..NADD {
        let cur = acc.clone();
        acc = cur + b.clone();
    }
    let add_ms = t.elapsed().as_secs_f64() * 1000.0 / NADD as f64;
    let chk: u64 = acc.clone().decrypt(&client_key);
    println!("[gpu] FheUint64 add = {:.2} ms/次（结果={}）", add_ms, chk);
    rows.push(format!("gpu_fheuint64_add,{:.2},,result={}", add_ms, chk));

    // 多条密文求和（模拟聚合）
    for n in [10usize, 100] {
        let cts: Vec<FheUint64> = (0..n).map(|i| FheUint64::encrypt((i % 100) as u64 + 1, &client_key)).collect();
        let t = Instant::now();
        let mut s: Option<FheUint64> = None;
        for c in cts {
            s = Some(match s { None => c, Some(x) => x + c });
        }
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        let got: u64 = s.unwrap().decrypt(&client_key);
        let expect: u64 = (0..n as u64).map(|i| i % 100 + 1).sum();
        println!("[gpu] sum n={:<4} wall={:>10.1} ms  ({:.2} ms/加法) 结果={} 期望={} {}",
                 n, ms, ms / (n - 1) as f64, got, expect, if got == expect { "OK" } else { "FAIL" });
        rows.push(format!("gpu_sum_n{},,{:.1},per_add={:.2}ms result={} expect={}", n, ms, ms / (n - 1) as f64, got, expect));
    }

    println!("\n[gpu] 进程峰值 RSS = {:.1} MB", vm_kb("VmHWM:") as f64 / 1024.0);
    let mut csv = String::from("tag,ms,note2,note\n");
    for r in &rows {
        csv.push_str(r);
        csv.push('\n');
    }
    let p = format!("{}/gpu_bench.csv", outdir);
    std::fs::write(&p, csv).unwrap();
    println!("[csv] 已写入 {}", p);
    println!("GPU_BENCH_DONE peak_rss_mb={:.1} cpu_ticks={}", vm_kb("VmHWM:") as f64 / 1024.0, cpu_ticks());
}

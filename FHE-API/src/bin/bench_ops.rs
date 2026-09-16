//! bench_ops —— 细粒度算子基准：把「解压」与「解密」拆开，并对比加密/压缩方式
//! 参数与 FHE-API 服务一致：PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS
//! 用法：cargo run --release --bin bench_ops -- [outdir]

use std::time::Instant;
use tfhe::prelude::*;
use tfhe::shortint::parameters::PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS;
use tfhe::{
    generate_keys, set_server_key, CompressedFheUint64, CompressedServerKey, ConfigBuilder, FheUint64,
};

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
fn rss() -> f64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines().find_map(|l| {
                l.strip_prefix("VmHWM:").and_then(|r| r.trim().trim_end_matches(" kB").trim().parse::<u64>().ok())
            })
        })
        .unwrap_or(0) as f64
        / 1024.0
}

fn main() {
    let outdir = std::env::args().nth(1).unwrap_or_else(|| "/root/Bisai/bench-results".into());
    std::fs::create_dir_all(&outdir).ok();
    println!("===== FHE 细粒度算子基准（2_2 参数, FheUint64）=====");

    let config = ConfigBuilder::default()
        .use_custom_parameters(PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS)
        .build();
    let (client_key, _sk) = generate_keys(config);
    let csk = CompressedServerKey::new(&client_key);
    set_server_key(csk.decompress());

    const N: usize = 200;
    let mut rows: Vec<String> = Vec::new();
    let mut rec = |name: &str, ms: f64, n: usize, note: &str| {
        let line = format!("{},{:.4},{:.4},{:.4},{}", name, ms, ms, n, note);
        rows.push(line);
        println!("[ops] {:<34} {:>10.4} ms   n={}  {}", name, ms, n, note);
    };

    // 1) CompressedFheUint64::try_encrypt（服务 /encrypt 用的方式）+ 序列化
    let mut v1 = Vec::new();
    let mut bufs = Vec::new();
    for i in 0..N {
        let t = Instant::now();
        let c = CompressedFheUint64::try_encrypt(i as u64 + 1, &client_key).unwrap();
        let b = bincode::serialize(&c).unwrap();
        v1.push(t.elapsed().as_secs_f64() * 1000.0);
        bufs.push(b);
    }
    rec("encrypt_compressed_serialize", mean(&v1), N, "try_encrypt + bincode");

    // 2) bincode 反序列化（服务 /compute /decrypt 的入口）
    let mut v2 = Vec::new();
    let mut dcts: Vec<CompressedFheUint64> = Vec::new();
    for b in &bufs {
        let t = Instant::now();
        let d: CompressedFheUint64 = bincode::deserialize(b).unwrap();
        v2.push(t.elapsed().as_secs_f64() * 1000.0);
        dcts.push(d);
    }
    rec("deserialize_compressed", mean(&v2), N, "bincode 反序列化");

    // 3) decompress()（压缩态 → 可计算态）
    let mut v3 = Vec::new();
    let mut pts: Vec<FheUint64> = Vec::new();
    for d in &dcts {
        let t = Instant::now();
        pts.push(d.decompress());
        v3.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    rec("decompress", mean(&v3), N, "CompressedFheUint64 -> FheUint64");

    // 4) decrypt()（已解压密文 → 明文）
    let mut v4 = Vec::new();
    let mut ok = true;
    for (i, p) in pts.iter().enumerate() {
        let t = Instant::now();
        let x: u64 = p.decrypt(&client_key);
        v4.push(t.elapsed().as_secs_f64() * 1000.0);
        if x != i as u64 + 1 {
            ok = false;
        }
    }
    rec("decrypt_only", mean(&v4), N, "FheUint64 -> u64（不含解压）");
    println!("[check] decrypt_only 正确={}", ok);

    // 5) 服务口径的“单条解密” = 反序列化 + 解压 + 解密
    let mut v5 = Vec::new();
    for b in &bufs {
        let t = Instant::now();
        let d: CompressedFheUint64 = bincode::deserialize(b).unwrap();
        let _x: u64 = d.decompress().decrypt(&client_key);
        v5.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    rec("decrypt_end_to_end(=deser+decomp+dec)", mean(&v5), N, "服务 /decrypt 口径");

    // 6) 非压缩加密（FheUint64::encrypt）—— 加密后可直接计算，无需解压
    let mut v6 = Vec::new();
    for i in 0..N {
        let t = Instant::now();
        let _c = FheUint64::encrypt(i as u64 + 1, &client_key);
        v6.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    rec("encrypt_uncompressed(FheUint64)", mean(&v6), N, "无需解压，可直接参与计算");

    // 7) compress()（计算后密文 → 压缩态）
    let mut v7 = Vec::new();
    for p in &pts {
        let t = Instant::now();
        let _c = p.compress();
        v7.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    rec("compress", mean(&v7), N, "FheUint64 -> CompressedFheUint64");

    // 8) 同态加法（单次）
    let a = FheUint64::encrypt(1u64, &client_key);
    let b = FheUint64::encrypt(2u64, &client_key);
    let mut acc = a.clone();
    for _ in 0..2 {
        let cur = acc.clone();
        acc = cur + b.clone();
    }
    const NA: usize = 10;
    let t = Instant::now();
    for _ in 0..NA {
        let cur = acc.clone();
        acc = cur + b.clone();
    }
    let add_ms = t.elapsed().as_secs_f64() * 1000.0 / NA as f64;
    rec("add(FheUint64+FheUint64)", add_ms, NA, "同态加法（含进位 PBS）");

    // 9) 同态加法（密文 + 明文标量）
    let mut acc2 = a.clone();
    let t = Instant::now();
    for _ in 0..NA {
        let cur = acc2.clone();
        acc2 = cur + 1u64;
    }
    let addc_ms = t.elapsed().as_secs_f64() * 1000.0 / NA as f64;
    rec("add_scalar(FheUint64+u64)", addc_ms, NA, "密文+明文标量");

    // 10) 服务端密钥解压+set（服务每次请求都做）
    let mut v10 = Vec::new();
    for _ in 0..5 {
        let t = Instant::now();
        set_server_key(csk.decompress());
        v10.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    rec("server_key_decompress_and_set", mean(&v10), 5, "每次 /compute /decrypt 重复执行");

    println!("\n[ops] 进程峰值 RSS = {:.1} MB", rss());
    let mut csv = String::from("op,mean_ms,p50_ms,p95_ms,n,note\n");
    for r in &rows {
        csv.push_str(r);
        csv.push('\n');
    }
    let p = format!("{}/fhe_ops_detail.csv", outdir);
    std::fs::write(&p, csv).unwrap();
    println!("[csv] 已写入 {}", p);
}

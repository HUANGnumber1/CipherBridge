//! bench_fhe —— FHE 各环节实测基准（与 FHE-API 服务完全同参数、同类型）
//!
//! 参数集：PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS
//! 类型：CompressedFheUint64 / CompressedCompactPublicKey / CompressedServerKey
//! 用法：cargo run --release --bin bench_fhe -- [outdir]
//!
//! 输出：<outdir>/fhe_cpu_stages.csv、<outdir>/fhe_cpu_scale.csv、<outdir>/fhe_cpu_sum.csv
//!       以及 stdout 的 JSON 汇总

use std::io::Write;
use std::time::Instant;
use tfhe::prelude::*;
use tfhe::shortint::parameters::PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS;
use tfhe::{
    generate_keys, set_server_key, CompressedCompactPublicKey, CompressedFheUint64,
    CompressedServerKey, ConfigBuilder, FheUint64,
};

// ---------------------------------------------------------------- 观测工具

fn vm_kb(field: &str) -> u64 {
    // field 形如 "VmRSS:" / "VmHWM:"
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines().find_map(|l| {
                l.strip_prefix(field).and_then(|r| {
                    r.trim()
                        .trim_end_matches(" kB")
                        .trim()
                        .parse::<u64>()
                        .ok()
                })
            })
        })
        .unwrap_or(0)
}

fn cpu_ticks() -> u64 {
    // /proc/self/stat：comm 之后 state(0) ... utime(11) stime(12)
    let s = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    let after = match s.rfind(')') {
        Some(i) => &s[i + 2..],
        None => return 0,
    };
    let f: Vec<&str> = after.split_whitespace().collect();
    let t = |i: usize| f.get(i).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    t(11) + t(12)
}

struct Snap {
    wall: Instant,
    cpu: u64,
    hwm: u64,
}

impl Snap {
    fn take() -> Self {
        Snap {
            wall: Instant::now(),
            cpu: cpu_ticks(),
            hwm: vm_kb("VmHWM:"),
        }
    }
    /// 返回 (wall_ms, cpu_ms, cpu_pct, hwm_mb)
    fn since(&self) -> (f64, f64, f64, f64) {
        let wall_ms = self.wall.elapsed().as_secs_f64() * 1000.0;
        let cpu_ms = (cpu_ticks().saturating_sub(self.cpu)) as f64 * 1000.0 / 100.0; // USER_HZ=100
        let pct = if wall_ms > 0.0 { cpu_ms / wall_ms * 100.0 } else { 0.0 };
        (wall_ms, cpu_ms, pct, vm_kb("VmHWM:") as f64 / 1024.0)
    }
}

fn pct(v: &[f64], p: f64) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let i = ((s.len() - 1) as f64 * p).round() as usize;
    s[i]
}

fn mean(v: &[f64]) -> f64 {
    if v.is_empty() {
        0.0
    } else {
        v.iter().sum::<f64>() / v.len() as f64
    }
}

struct Csv {
    path: String,
    buf: String,
}

impl Csv {
    fn new(dir: &str, name: &str, header: &str) -> Self {
        std::fs::create_dir_all(dir).ok();
        let path = format!("{}/{}", dir, name);
        Csv {
            path,
            buf: format!("{}\n", header),
        }
    }
    fn row(&mut self, line: String) {
        self.buf.push_str(&line);
        self.buf.push('\n');
        println!("{}", line);
    }
    fn save(&self) {
        let mut f = std::fs::File::create(&self.path).unwrap();
        f.write_all(self.buf.as_bytes()).unwrap();
        println!("[csv] 已写入 {}", self.path);
    }
}

// ---------------------------------------------------------------- 主流程

fn main() {
    let outdir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/root/Bisai/bench-results".to_string());

    println!("===== FHE 基准开始 =====");
    println!("参数集 : PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS");
    println!("类型   : CompressedFheUint64 (u64, 64-bit 整数)");
    println!(
        "线程   : {}",
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(0)
    );
    println!("{:#?}", PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS);

    let mut st = Csv::new(
        &outdir,
        "fhe_cpu_stages.csv",
        "stage,wall_ms,cpu_ms,cpu_pct,peak_rss_mb,note",
    );

    // ---------- 1) 密钥生成 ----------
    let t = Snap::take();
    let config = ConfigBuilder::default()
        .use_custom_parameters(PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS)
        .build();
    let (client_key, _server_key) = generate_keys(config);
    let (w, c, cp, h) = t.since();
    st.row(format!(
        "keygen_generate_keys,{:.1},{:.1},{:.1},{:.1},generate_keys(含参数编译)",
        w, c, cp, h
    ));

    let t = Snap::take();
    let compact_pk = CompressedCompactPublicKey::new(&client_key);
    let (w, c, cp, h) = t.since();
    st.row(format!(
        "keygen_compressed_public_key,{:.1},{:.1},{:.1},{:.1},CompressedCompactPublicKey::new",
        w, c, cp, h
    ));

    let t = Snap::take();
    let compressed_server_key = CompressedServerKey::new(&client_key);
    let (w, c, cp, h) = t.since();
    st.row(format!(
        "keygen_compressed_server_key,{:.1},{:.1},{:.1},{:.1},CompressedServerKey::new",
        w, c, cp, h
    ));

    // 密钥体积
    let pk_bytes = bincode::serialize(&compact_pk).unwrap().len();
    let sk_bytes = bincode::serialize(&compressed_server_key).unwrap().len();
    let ck_bytes = bincode::serialize(&client_key).unwrap().len();
    st.row(format!(
        "size_public_key,{},{},,,-,bytes(base64前)",
        pk_bytes, pk_bytes
    ));
    st.row(format!(
        "size_server_key,{},{},,,-,bytes(base64前)",
        sk_bytes, sk_bytes
    ));
    st.row(format!(
        "size_client_key,{},{},,,-,bytes(base64前)",
        ck_bytes, ck_bytes
    ));
    println!(
        "[size] public_key={} B  server_key={} B  client_key={} B",
        pk_bytes, sk_bytes, ck_bytes
    );

    // ---------- 2) set_server_key（服务端每次请求都要做一次解压） ----------
    let t = Snap::take();
    set_server_key(compressed_server_key.decompress());
    let (w, c, cp, h) = t.since();
    st.row(format!(
        "server_key_decompress_and_set,{:.1},{:.1},{:.1},{:.1},服务端每次 /compute /decrypt 都会重复执行",
        w, c, cp, h
    ));

    // ---------- 3) 单条数据加密 ----------
    const ENC_N: usize = 200;
    let t = Snap::take();
    let mut enc_ms = Vec::with_capacity(ENC_N);
    let mut buf: Vec<Vec<u8>> = Vec::with_capacity(ENC_N);
    for i in 0..ENC_N {
        let t1 = Instant::now();
        let c = CompressedFheUint64::try_encrypt((i as u64) * 7 + 1, &client_key).unwrap();
        let b = bincode::serialize(&c).unwrap();
        enc_ms.push(t1.elapsed().as_secs_f64() * 1000.0);
        buf.push(b);
    }
    let (w, c, cp, h) = t.since();
    st.row(format!(
        "encrypt_single_total,{:.1},{:.1},{:.1},{:.1},{} 次单条加密+序列化 合计",
        w, c, cp, h, ENC_N
    ));
    st.row(format!(
        "encrypt_single_avg,{:.3},{:.3},{:.3},{:.3},mean",
        mean(&enc_ms),
        mean(&enc_ms),
        cp,
        h
    ));
    st.row(format!(
        "encrypt_single_p50,{:.3},{:.3},{:.3},{:.3},p50",
        pct(&enc_ms, 0.50),
        pct(&enc_ms, 0.50),
        cp,
        h
    ));
    st.row(format!(
        "encrypt_single_p95,{:.3},{:.3},{:.3},{:.3},p95",
        pct(&enc_ms, 0.95),
        pct(&enc_ms, 0.95),
        cp,
        h
    ));
    println!(
        "[encrypt] avg={:.3} ms  p50={:.3} ms  p95={:.3} ms  (n={})",
        mean(&enc_ms),
        pct(&enc_ms, 0.50),
        pct(&enc_ms, 0.95),
        ENC_N
    );

    // 密文体积
    let ct_bytes = buf[0].len();
    println!("[size] compressed ciphertext = {} B", ct_bytes);
    {
        let mut sz = Csv::new(
            &outdir,
            "fhe_cpu_sizes.csv",
            "item,bytes,base64_bytes,note",
        );
        // 密文：压缩态 / 解压态
        let d = bincode::deserialize::<CompressedFheUint64>(&buf[0]).unwrap();
        let plain_ct = d.decompress();
        let ct_raw = bincode::serialize(&plain_ct).unwrap().len();
        let b64 = |n: usize| (n + 2) / 3 * 4;
        sz.row(format!("compressed_ciphertext,{},{},CompressedFheUint64", ct_bytes, b64(ct_bytes)));
        sz.row(format!("decompressed_ciphertext,{},{},FheUint64", ct_raw, b64(ct_raw)));
        sz.row(format!("public_key,{},{},CompressedCompactPublicKey", pk_bytes, b64(pk_bytes)));
        sz.row(format!("server_key,{},{},CompressedServerKey", sk_bytes, b64(sk_bytes)));
        sz.row(format!("client_key,{},{},ClientKey", ck_bytes, b64(ck_bytes)));
        sz.save();
    }

    // ---------- 4) 解密 ----------
    let t = Snap::take();
    let mut deser_ms = Vec::new();
    let mut dec_ms = Vec::new();
    let mut plain = Vec::with_capacity(ENC_N);
    for b in &buf {
        let t1 = Instant::now();
        let d: CompressedFheUint64 = bincode::deserialize(b).unwrap();
        deser_ms.push(t1.elapsed().as_secs_f64() * 1000.0);
        let t2 = Instant::now();
        let p: u64 = d.decompress().decrypt(&client_key);
        dec_ms.push(t2.elapsed().as_secs_f64() * 1000.0);
        plain.push(p);
    }
    let (w, c, cp, h) = t.since();
    st.row(format!(
        "decrypt_batch_total,{:.1},{:.1},{:.1},{:.1},{} 条 反序列化+解压+解密 合计",
        w, c, cp, h, ENC_N
    ));
    st.row(format!(
        "decrypt_single_avg,{:.3},{:.3},{:.1},{:.1},反序列化+解压+解密 mean",
        mean(&dec_ms),
        mean(&dec_ms),
        cp,
        h
    ));
    st.row(format!(
        "decrypt_single_p95,{:.3},{:.3},{:.1},{:.1},p95",
        pct(&dec_ms, 0.95),
        pct(&dec_ms, 0.95),
        cp,
        h
    ));
    st.row(format!(
        "deserialize_single_avg,{:.3},{:.3},{:.1},{:.1},bincode 反序列化 mean",
        mean(&deser_ms),
        mean(&deser_ms),
        cp,
        h
    ));
    println!(
        "[decrypt] avg={:.3} ms  p95={:.3} ms  (deserialize avg={:.3} ms)",
        mean(&dec_ms),
        pct(&dec_ms, 0.95),
        mean(&deser_ms)
    );
    // 正确性校验
    let ok = plain
        .iter()
        .enumerate()
        .all(|(i, v)| *v == (i as u64) * 7 + 1);
    println!("[check] 解密结果与明文一致: {}", ok);
    assert!(ok, "加解密闭环不一致");

    // ---------- 5) 多条密文求和 ----------
    let mut sum = Csv::new(
        &outdir,
        "fhe_cpu_sum.csv",
        "n_terms,total_ms,per_term_ms,deserialize_total_ms,decompress_total_ms,add_total_ms,peak_rss_mb,result",
    );
    for n in [10usize, 100, 1000] {
        // 造 n 条密文
        let mut cts: Vec<Vec<u8>> = Vec::with_capacity(n);
        for i in 0..n {
            let c = CompressedFheUint64::try_encrypt((i % 100) as u64 + 1, &client_key).unwrap();
            cts.push(bincode::serialize(&c).unwrap());
        }
        let expect: u64 = (0..n as u64).map(|i| i % 100 + 1).sum();

        let t_all = Snap::take();
        let mut t_deser = 0.0f64;
        let mut t_decomp = 0.0f64;
        let mut t_add = 0.0f64;
        let mut acc: Option<FheUint64> = None;
        for b in &cts {
            let t1 = Instant::now();
            let d: CompressedFheUint64 = bincode::deserialize(b).unwrap();
            t_deser += t1.elapsed().as_secs_f64() * 1000.0;
            let t2 = Instant::now();
            let v = d.decompress();
            t_decomp += t2.elapsed().as_secs_f64() * 1000.0;
            let t3 = Instant::now();
            match acc {
                None => acc = Some(v),
                Some(ref mut s) => {
                    let cur = s.clone();
                    *s = cur + v;
                }
            }
            t_add += t3.elapsed().as_secs_f64() * 1000.0;
        }
        let result_ct = acc.unwrap();
        let t_dec = Instant::now();
        let got: u64 = result_ct.clone().decrypt(&client_key);
        let dec_one = t_dec.elapsed().as_secs_f64() * 1000.0;
        let (w, _c, _cp, h) = t_all.since();

        sum.row(format!(
            "{},{:.1},{:.3},{:.1},{:.1},{:.1},{:.1},sum={} (期望 {} / 解密 {:.2}ms)",
            n,
            w,
            w / n as f64,
            t_deser,
            t_decomp,
            t_add,
            h,
            got,
            expect,
            dec_one
        ));
        assert_eq!(got, expect, "n={} 同态求和结果错误", n);

        // 求和后密文体积不变
        let s = bincode::serialize(&result_ct.compress()).unwrap().len();
        println!("[sum] n={} 结果密文 {} B（与单条相同）", n, s);
    }
    sum.save();

    st.save();

    let (w, _c, _cp, h) = Snap::take().since();
    println!("===== FHE 基准结束 wall={:.1}ms 进程峰值RSS={:.1}MB =====", w, h);
    println!(
        "{{\"peak_rss_mb\":{:.1},\"outdir\":\"{}\"}}",
        vm_kb("VmHWM:") as f64 / 1024.0,
        outdir
    );
}

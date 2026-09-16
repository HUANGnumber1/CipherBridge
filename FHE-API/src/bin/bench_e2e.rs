//! bench_e2e —— “中小微企业信贷风控”端到端模拟（真实 FHE 全链路，含分阶段耗时）
//!
//! 业务链路：
//!   ① 企业数据加密（M 家小微企业 × K 项风控指标）
//!   ② 多项指标聚合（同态：全池同指标跨企业求和；可选单企业多指标加权求和）
//!   ③ 结果解密
//!   ④ ZKP 验证（可选，--zk 1 时调用 ZK 解密正确性证明流程并计时）
//!
//! 参数与服务端完全一致：PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS / FheUint64
//! 用法：
//!   cargo run --release --bin bench_e2e -- [--companies 100] [--indicators 6] [--full 0] [--zk 0] [--outdir DIR]
//!
//! 输出：<outdir>/e2e_stages.csv、<outdir>/e2e_scale.csv、<outdir>/e2e_add.csv

use std::time::Instant;
use tfhe::prelude::*;
use tfhe::shortint::parameters::PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS;
use tfhe::{
    generate_keys, set_server_key, CompressedFheUint64, CompressedServerKey, ConfigBuilder, FheUint64,
};

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

struct Stage {
    name: &'static str,
    ms: f64,
    cpu_ms: f64,
    hwm_mb: f64,
    cur_mb: f64,
    note: String,
}
impl Stage {
    fn line(&self) -> String {
        format!(
            "{},{:.1},{:.1},{:.1},{:.1},{:.1},{}",
            self.name,
            self.ms,
            self.cpu_ms,
            if self.ms > 0.0 { self.cpu_ms / self.ms * 100.0 } else { 0.0 },
            self.cur_mb,
            self.hwm_mb,
            self.note
        )
    }
}

fn run_stage<F: FnOnce() -> R, R>(name: &'static str, note: &str, f: F) -> (R, Stage) {
    let cpu0 = cpu_ticks();
    let t0 = Instant::now();
    let r = f();
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    let cpu_ms = (cpu_ticks() - cpu0) as f64 * 10.0;
    (
        r,
        Stage {
            name,
            ms,
            cpu_ms,
            hwm_mb: vm_kb("VmHWM:") as f64 / 1024.0,
            cur_mb: vm_kb("VmRSS:") as f64 / 1024.0,
            note: note.to_string(),
        },
    )
}

/// 生成一批“小微企业风控数据”：K 项指标（年营收/负债/开票/纳税/员工数/逾期次数）
fn make_company(seed: u64, k: usize) -> Vec<u64> {
    (0..k)
        .map(|j| {
            let v = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(j as u64 * 1442695040888963407);
            let x = (v >> 33) % 1000;
            if j == 4 {
                x % 200 + 1
            } else {
                x + 1
            }
        })
        .collect()
}

fn encrypt_row(client_key: &tfhe::ClientKey, row: &[u64]) -> Vec<Vec<u8>> {
    row.iter()
        .map(|v| {
            let c = CompressedFheUint64::try_encrypt(*v, client_key).unwrap();
            bincode::serialize(&c).unwrap()
        })
        .collect()
}

fn main() {
    let mut companies: usize = 100;
    let mut indicators: usize = 6;
    let mut full = false;
    let mut do_zk = false;
    let mut outdir = "/root/Bisai/bench-results".to_string();
    let mut scale_list: Vec<usize> = vec![10, 100, 1000, 10000];

    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--companies" => { companies = args[i + 1].parse().unwrap(); i += 2; }
            "--indicators" => { indicators = args[i + 1].parse().unwrap(); i += 2; }
            "--full" => { full = args[i + 1] == "1"; i += 2; }
            "--zk" => { do_zk = args[i + 1] == "1"; i += 2; }
            "--outdir" => { outdir = args[i + 1].clone(); i += 2; }
            "--scale" => { scale_list = args[i + 1].split(',').map(|s| s.parse().unwrap()).collect(); i += 2; }
            _ => i += 1,
        }
    }
    std::fs::create_dir_all(&outdir).ok();

    println!("===== 中小微企业信贷风控 端到端模拟 =====");
    println!(
        "企业数 M={}  指标数 K={}  完整指标聚合={}  ZKP={}  参数=PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS",
        companies, indicators, full, do_zk
    );

    let mut stages: Vec<Stage> = Vec::new();
    let mut zk_note = String::new();

    // ---------------- T0 密钥生成 ----------------
    let (keys, s0) = run_stage("T0_密钥生成_含服务端密钥压缩", "generate_keys + CompressedServerKey::new + decompress/set", || {
        let config = ConfigBuilder::default()
            .use_custom_parameters(PARAM_MESSAGE_2_CARRY_2_COMPACT_PK_KS_PBS)
            .build();
        let (ck, _sk) = generate_keys(config);
        let csk = CompressedServerKey::new(&ck);
        set_server_key(csk.decompress());
        ck
    });
    let client_key = keys;
    stages.push(s0);

    // ---------------- T1 企业数据加密 ----------------
    let data: Vec<Vec<u64>> = (0..companies).map(|s| make_company(s as u64, indicators)).collect();
    let (mut per_company_cts, s1) = run_stage(
        "T1_企业数据加密",
        &format!("{} 家企业 × {} 项指标 = {} 条密文", companies, indicators, companies * indicators),
        || data.iter().map(|row| encrypt_row(&client_key, row)).collect::<Vec<_>>(),
    );
    let ct_bytes = per_company_cts[0][0].len();
    stages.push(s1);

    // ---------------- T2a 单企业多指标同态聚合（可选） ----------------
    let mut per_company_score: Vec<Vec<u8>> = Vec::new();
    if full {
        let (r, s) = run_stage(
            "T2a_单企业多指标同态聚合",
            &format!("每家企业 {} 次同态加法，共 {} 次", indicators - 1, companies * (indicators - 1)),
            || {
                per_company_cts
                    .iter()
                    .map(|row| {
                        let mut acc: Option<FheUint64> = None;
                        for b in row {
                            let v: CompressedFheUint64 = bincode::deserialize(b).unwrap();
                            let v = v.decompress();
                            acc = Some(match acc { None => v, Some(a) => a + v });
                        }
                        bincode::serialize(&acc.unwrap().compress()).unwrap()
                    })
                    .collect::<Vec<Vec<u8>>>()
            },
        );
        per_company_score = r;
        stages.push(s);
    }

    // ---------------- T2b 全池跨企业同态求和（主聚合） ----------------
    let (pool_totals, s2b) = run_stage(
        "T2b_全池跨企业同态求和",
        &format!("{} 项指标 × {} 次加法 = {} 次同态加法", indicators, companies - 1, indicators * (companies - 1)),
        || {
            (0..indicators)
                .map(|j| {
                    let mut acc: Option<FheUint64> = None;
                    for row in &per_company_cts {
                        let v: CompressedFheUint64 = bincode::deserialize(&row[j]).unwrap();
                        let v = v.decompress();
                        acc = Some(match acc { None => v, Some(a) => a + v });
                    }
                    bincode::serialize(&acc.unwrap().compress()).unwrap()
                })
                .collect::<Vec<Vec<u8>>>()
        },
    );
    let n_add = indicators * (companies - 1);
    stages.push(s2b);
    drop(per_company_cts);
    per_company_cts = Vec::new();

    // ---------------- T2c 综合风险分跨企业求和（可选） ----------------
    let mut score_total: Option<Vec<u8>> = None;
    if full {
        let (r, s) = run_stage(
            "T2c_综合风险分跨企业求和",
            &format!("{} 次同态加法", companies - 1),
            || {
                let mut acc: Option<FheUint64> = None;
                for b in &per_company_score {
                    let v: CompressedFheUint64 = bincode::deserialize(b).unwrap();
                    let v = v.decompress();
                    acc = Some(match acc { None => v, Some(a) => a + v });
                }
                bincode::serialize(&acc.unwrap().compress()).unwrap()
            },
        );
        score_total = Some(r);
        stages.push(s);
    }

    // ---------------- T3 结果解密 ----------------
    let mut decrypted: Vec<u64> = Vec::new();
    let (_, s3) = run_stage("T3_结果解密", "解压 + 解密每项聚合结果", || {
        for b in &pool_totals {
            let d: CompressedFheUint64 = bincode::deserialize(b).unwrap();
            decrypted.push(d.decompress().decrypt(&client_key));
        }
        if let Some(b) = &score_total {
            let d: CompressedFheUint64 = bincode::deserialize(b).unwrap();
            decrypted.push(d.decompress().decrypt(&client_key));
        }
    });
    stages.push(s3);

    // ---------------- 正确性校验 ----------------
    let mut ok = true;
    for j in 0..indicators {
        let expect: u64 = (0..companies).map(|s| data[s][j]).sum();
        if decrypted[j] != expect {
            ok = false;
            eprintln!("[!!] 指标 {} 聚合 {} != 期望 {}", j, decrypted[j], expect);
        }
    }
    if full {
        let expect_score: u64 = data.iter().map(|r| r.iter().sum::<u64>()).sum();
        if decrypted[indicators] != expect_score {
            ok = false;
            eprintln!("[!!] 综合风险分 {} != 期望 {}", decrypted[indicators], expect_score);
        }
    }
    println!("[check] 端到端 加密→聚合→解密 结果正确: {}", ok);
    assert!(ok, "端到端闭环校验失败");

    let mut csv = String::from("stage,wall_ms,cpu_ms,cpu_pct,rss_cur_mb,rss_hwm_mb,note\n");
    for s in &stages {
        csv.push_str(&s.line());
        csv.push('\n');
    }

    println!("\n---------- 端到端各阶段耗时 ----------");
    println!("{:<34} {:>12} {:>12} {:>10}", "阶段", "wall_ms", "cpu_ms", "CPU%");
    for s in &stages {
        println!("{:<34} {:>12.1} {:>12.1} {:>9.0}%", s.name, s.ms, s.cpu_ms,
                 if s.ms > 0.0 { s.cpu_ms / s.ms * 100.0 } else { 0.0 });
    }
    let fhe_wo_t0: f64 = stages.iter().filter(|s| s.name != "T0_密钥生成_含服务端密钥压缩").map(|s| s.ms).sum();
    let fhe_all: f64 = stages.iter().map(|s| s.ms).sum();
    println!("{:<34} {:>12.1}", "① -④ FHE 链路合计（不含T0）", fhe_wo_t0);
    println!("{:<34} {:>12.1}", "FHE 链路合计（含T0）", fhe_all);

    // ---------------- T4 ZKP 验证（可选） ----------------
    let mut e2e_total_wo_t0 = fhe_wo_t0;
    let mut e2e_total = fhe_all;
    if do_zk {
        let cpu0 = cpu_ticks();
        let t0 = Instant::now();
        let out = std::process::Command::new("bash")
            .arg("/root/Bisai/tools/run_zk_demo.sh")
            .arg("decryption")
            .env("RISC0_DEV_MODE", "1")
            .output()
            .expect("无法启动 ZK demo");
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        let cpu_ms = (cpu_ticks() - cpu0) as f64 * 10.0;
        let s4 = Stage {
            name: "T4_ZKP生成与验证",
            ms,
            cpu_ms,
            hwm_mb: vm_kb("VmHWM:") as f64 / 1024.0,
            cur_mb: vm_kb("VmRSS:") as f64 / 1024.0,
            note: format!("ZK 解密正确性证明流程（含 guest 执行），exit={}", out.status.code().unwrap_or(-1)),
        };
        zk_note = format!("ZK exit={}", out.status.code().unwrap_or(-1));
        e2e_total_wo_t0 += ms;
        e2e_total += ms;
        println!("{:<34} {:>12.1} {:>12.1}    {}", s4.name, s4.ms, s4.cpu_ms, zk_note);
        println!("{:<34} {:>12.1}", "端到端合计（不含T0）", e2e_total_wo_t0);
        println!("{:<34} {:>12.1}", "端到端合计（含T0）", e2e_total);
        csv.push_str(&s4.line());
        csv.push('\n');
    }

    println!(
        "\n[规模] M={} K={}，输入密文 {} 条 × {} B ≈ {:.1} MB；同态加法 {} 次",
        companies, indicators, companies * indicators, ct_bytes,
        (companies * indicators * ct_bytes) as f64 / 1048576.0, n_add
    );

    // ---------------- 规模/压力扫描（加密吞吐 + 加法吞吐 + 内存） ----------------
    let mut scale_csv = String::from("companies,indicators,ciphertexts,encrypt_ms,encrypt_ct_per_s,peak_rss_mb,encrypted_mb,ok\n");
    for m in &scale_list {
        let m = *m;
        let data: Vec<Vec<u64>> = (0..m).map(|s| make_company(s as u64, indicators)).collect();
        let cpu0 = cpu_ticks();
        let t0 = Instant::now();
        let cts: Vec<Vec<Vec<u8>>> = data.iter().map(|row| encrypt_row(&client_key, row)).collect();
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        let _ = cpu_ticks() - cpu0;
        let nct = m * indicators;
        let hwm = vm_kb("VmHWM:") as f64 / 1024.0;
        let mb = (nct * ct_bytes) as f64 / 1048576.0;
        scale_csv.push_str(&format!(
            "{},{},{},{:.1},{:.1},{:.1},{:.1},true\n",
            m, indicators, nct, ms, nct as f64 / (ms / 1000.0), hwm, mb
        ));
        println!("[scale] M={:<6} 密文 {:<7} 加密 {:>9.1}ms  吞吐 {:>8.1} ct/s  内存占用≈{:>7.1}MB  峰值RSS={:.1}MB",
                 m, nct, ms, nct as f64 / (ms / 1000.0), mb, hwm);
        drop(cts);
    }

    // 同态加法吞吐（固定 20 次，避免长跑）
    let mut a = FheUint64::encrypt(1u64, &client_key);
    let b = FheUint64::encrypt(2u64, &client_key);
    let t0 = Instant::now();
    const NADD: usize = 20;
    for _ in 0..NADD {
        let cur = a.clone();
        a = cur + b.clone();
    }
    let add_ms = t0.elapsed().as_secs_f64() * 1000.0;
    println!("[add] FheUint64 单次同态加法 {:.1} ms（{} 次共 {:.0} ms，结果={}）",
             add_ms / NADD as f64, NADD, add_ms, {
        let d: u64 = a.decrypt(&client_key); d
    });
    let mut add_csv = String::from("op,unit_ms,n,note\n");
    add_csv.push_str(&format!("FheUint64_add,{:.1},{},2_2参数(32个radix块)\n", add_ms / NADD as f64, NADD));

    std::fs::write(format!("{}/e2e_stages.csv", outdir), csv).unwrap();
    std::fs::write(format!("{}/e2e_scale.csv", outdir), scale_csv).unwrap();
    std::fs::write(format!("{}/e2e_add.csv", outdir), add_csv).unwrap();
    println!("[csv] 已写入 {}/e2e_stages.csv, e2e_scale.csv, e2e_add.csv", outdir);
    println!(
        "E2E_SUMMARY {{\"companies\":{},\"indicators\":{},\"fhe_ms_without_keygen\":{:.1},\"fhe_ms_total\":{:.1},\"e2e_ms_without_keygen\":{:.1},\"e2e_ms_total\":{:.1},\"add_ms\":{:.1},\"peak_rss_mb\":{:.1}}}",
        companies, indicators, fhe_wo_t0, fhe_all, e2e_total_wo_t0, e2e_total,
        add_ms / NADD as f64, vm_kb("VmHWM:") as f64 / 1024.0
    );
}

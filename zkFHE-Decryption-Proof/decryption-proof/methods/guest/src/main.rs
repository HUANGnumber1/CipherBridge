#![no_main]
#![no_std]

extern crate alloc;
use alloc::format;
use alloc::vec::Vec;
use risc0_zkvm::guest::env;

//use concrete_ntt::prime64::Plan;

use tfhe::core_crypto::entities::*;
use tfhe::core_crypto::commons::parameters::*;
use tfhe::core_crypto::algorithms::*;
use tfhe::core_crypto::prelude::*;

//use tfhe::core_crypto::prelude::*;
//use rayon::prelude::*;

risc0_zkvm::guest::entry!(main);
//use serde::Deserialize;

// ────────────────────────────────────────────────────────────────────────────
// guest 内存预算（重要，改动前务必先读）
//
// risc0 1.2 的 guest 地址空间硬上限是 192MiB
// （risc0-zkvm-platform::memory::GUEST_MAX_MEM = SYSTEM.start = 0x0C00_0000），
// 堆从 guest ELF 的 _end 一直顶到该上限；一旦超出就打印
// “memory allocation of 67108864 bytes failed” 并 abort，
// host 侧表现为 `Trap: IllegalInstruction(c0001073)`。
//
// 本 demo 的 7 份输入里有两份体积极大、但**完全不参与后续计算**的 PBS 工件：
//   std_bootstrapping_key ≈ 6.08M × u64 ≈ 48.6MB
//   fourier_bsk           ≈ 3.04M × c64  ≈ 48.6MB
// 旧写法先把它们读成 Vec<u8>、再 bincode 反序列化成完整结构体：输入缓冲与目标结构体
// 的内部缓冲会同时驻留，且 bincode 对 Vec<T> 走容量倍增（32MiB → 64MiB），
// 峰值 ≈160MiB → 在 192MiB 的 zkVM 里必然失败（定位过程见
// docs/WORK_LOG_2026-09-14.md §3–§6）。
//
// 现在的写法：这两份大输入仍然**被完整读入**（因此依旧被绑进本次执行的 input digest，
// 密码学绑定性质不变），只做「字节数 + 头部长度字段」的形状校验，随后立刻释放；
// 峰值回落到「单个输入缓冲」级别（≈96MiB 以内），远低于 192MiB 上限。
// 注意：env::read 的顺序必须与 host 侧 ExecutorEnvBuilder 的 .write() 顺序完全一致。
// ────────────────────────────────────────────────────────────────────────────

/// 校验并立刻释放一份「大而不参与计算」的输入（返回读到的字节数）。
fn verify_and_release(context: &str, raw: Vec<u8>) -> usize {
    // bincode 1.x 默认（fixint、小端）下，结构体的**第一个字段**就是容器本身：
    //   LweBootstrapKey        → GgswCiphertextList.data: Vec<u64>
    //   FourierLweBootstrapKey → FourierPolynomialList.data: ABox<[c64]>
    // 因此 payload 的前 8 字节是 bincode 写下的该容器长度（Vec<u64> 时即标量个数）。
    // 这里只把它打印出来做形状校验，不对具体数值做强断言，避免耦合到 serde 实现细节。
    assert!(
        raw.len() >= 8,
        "{}: payload 只有 {} 字节，装不下 bincode 的长度头",
        context,
        raw.len()
    );
    let declared_len = (raw[0] as u64)
        | ((raw[1] as u64) << 8)
        | ((raw[2] as u64) << 16)
        | ((raw[3] as u64) << 24)
        | ((raw[4] as u64) << 32)
        | ((raw[5] as u64) << 40)
        | ((raw[6] as u64) << 48)
        | ((raw[7] as u64) << 56);
    assert!(declared_len > 0, "{}: 长度头为 0，输入可能已损坏", context);
    let len = raw.len();
    env::log(&format!(
        "ZK2: {} transferred OK: {} bytes, leading container length = {}",
        context, len, declared_len
    ));
    drop(raw); // 立即释放这一份 ≈48.6MB 输入缓冲，之后才读下一份
    len
}

/// bincode 反序列化（带上下文信息的报错，便于定位是第几份输入出了问题）
fn deserialize_with_context<T: for<'a> serde::Deserialize<'a>>(data: &[u8], context: &str) -> T {
    bincode::deserialize(data).unwrap_or_else(|e| {
        panic!("Failed to deserialize {}: {:?}", context, e);
    })
}

fn main() {
    env::log("ZK2: guest start (expecting 7 inputs)");

    // 1) std_bootstrapping_key（≈48.6MB）：只证明它被完整传入 zkVM 并被本次执行绑定，
    //    不物化结构体（它不参与后续解密/断言），读完立刻释放
    let serialized_std_bootstrapping_key: Vec<u8> = env::read();
    verify_and_release("std_bootstrapping_key", serialized_std_bootstrapping_key);

    // 2) fourier_bsk（≈48.6MB）：傅里叶域 bootstrap key，同上
    let serialized_fourier_bsk: Vec<u8> = env::read();
    verify_and_release("fourier_bsk", serialized_fourier_bsk);

    // 3) lwe_ciphertext_in_clear（PBS 的输入密文，很小）
    let serialized_lwe_ciphertext_in_clear: Vec<u8> = env::read();
    let _lwe_ciphertext_in_clear: LweCiphertextOwned<u64> =
        deserialize_with_context(&serialized_lwe_ciphertext_in_clear, "lwe_ciphertext_in_clear");
    drop(serialized_lwe_ciphertext_in_clear);

    // 4) cleartext_multiplication_result（明文乘法结果，后面要用来断言）
    let serialized_cleartext_multiplication_result: Vec<u8> = env::read();
    let cleartext_multiplication_result: u64 = deserialize_with_context(
        &serialized_cleartext_multiplication_result,
        "cleartext_multiplication_result",
    );
    drop(serialized_cleartext_multiplication_result);

    // 5) accumulator（PBS 的 LUT，很小；本 demo 不在 guest 内重算 PBS，仅校验可反序列化）
    let serialized_accumulator: Vec<u8> = env::read();
    let _accumulator: GlweCiphertextOwned<u64> =
        deserialize_with_context(&serialized_accumulator, "accumulator");
    drop(serialized_accumulator);

    // 6) pbs_multiplication_ct（PBS 的输出密文，后面要解密并 commit）
    let serialized_pbs: Vec<u8> = env::read();
    let pbs_multiplication_ct: LweCiphertextOwned<u64> =
        deserialize_with_context(&serialized_pbs, "pbs");
    drop(serialized_pbs);

    // 7) big_lwe_sk（解密用的 LWE 私钥，很小）
    let serialized_big_lwe_sk: Vec<u8> = env::read();
    let big_lwe_sk: LweSecretKeyOwned<u64> =
        deserialize_with_context(&serialized_big_lwe_sk, "big_lwe_sk");
    drop(serialized_big_lwe_sk);

    env::log("ZK2: all 7 inputs consumed");

    // Constants
    let message_modulus = 1u64 << 4;
    let delta = (1_u64 << 63) / message_modulus;

    // Decrypt and verify
    let pbs_multiplication_plaintext = decrypt_lwe_ciphertext(&big_lwe_sk, &pbs_multiplication_ct);

    let signed_decomposer =
        SignedDecomposer::new(DecompositionBaseLog(5), DecompositionLevelCount(1));
    let pbs_multiplication_result =
        signed_decomposer.closest_representable(pbs_multiplication_plaintext.0) / delta;

    env::log(&format!(
        "ZK2: guest decrypted PBS output = {} (expected {})",
        pbs_multiplication_result, cleartext_multiplication_result
    ));

    // Verify results match
    assert_eq!(cleartext_multiplication_result, pbs_multiplication_result);

    // Commit the result
    env::commit(&pbs_multiplication_ct);
}


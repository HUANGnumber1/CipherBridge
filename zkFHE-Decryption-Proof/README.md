# zkFHE-Decryption-Proof / zkFHE 解密证明

A zero-knowledge proof demo for TFHE decryption operations.
一个用于 TFHE 解密操作的零知识证明演示。

## Overview / 概述

This project demonstrates how to create zero-knowledge proofs for TFHE (Fully Homomorphic Encryption) operations, specifically focusing on proving correct decryption without revealing the secret key.

本项目演示了如何为 TFHE（全同态加密）操作创建零知识证明，特别关注如何在不泄露密钥的情况下证明解密操作的正确性。

## Key Components / 主要组件

### Host Program / 主程序
- Generates encryption keys / 生成加密密钥
- Creates and encrypts input messages / 创建并加密输入消息
- Performs homomorphic operations / 执行同态运算
- Manages the proving process / 管理证明过程

### Guest Program / 客户端程序
- Verifies decryption operations / 验证解密操作
- Ensures computation correctness / 确保计算正确性
- Generates zero-knowledge proofs / 生成零知识证明

## Technical Details / 技术细节

### Parameters / 参数设置
- Small LWE dimension: 742
- GLWE dimension: 1
- Polynomial size: 2048
- Message space: 4 bits
- Delta encoding: 2^63 / 2^4

### Key Operations / 关键操作
1. Key Generation / 密钥生成
   - Generates LWE and GLWE secret keys / 生成 LWE 和 GLWE 密钥
   - Creates bootstrapping keys / 创建自举密钥

2. Encryption / 加密
   - Encrypts messages using LWE / 使用 LWE 加密消息
   - Supports homomorphic operations / 支持同态运算

3. Verification / 验证
   - Proves correct decryption / 证明解密正确性
   - Validates computation results / 验证计算结果

## Usage / 使用方法

Install Risc0 / 安装零知识证明框架
rzup is the RISC Zero toolchain installer. We recommend using rzup to manage the installation of RISC Zero.
rzup 是 RISC Zero 的工具链安装器。我们推荐使用 rzup 来管理 RISC Zero 的安装。

1. Install rzup / 安装 rzup:
```bash
curl -L https://risczero.com/install | bash
```

2. Install RISC Zero / 安装 RISC Zero:
```bash
rzup install
```

Build the project / 构建项目
```bash
cd decryption-proof
cargo build
```

Run the demo / 运行演示
```bash
RISC0_DEV_MODE=1 RUST_BACKTRACE=1 cargo run
```
## Security Notes / 安全说明

This is a demonstration project and uses toy parameters. For production use, please adjust security parameters accordingly.

这是一个演示项目，使用了测试参数。在生产环境中使用时，请相应调整安全参数。

## Dependencies / 依赖项
- TFHE-rs: Fully Homomorphic Encryption library / 全同态加密库
- RISC0: Zero-knowledge proof system / 零知识证明系统
- Bincode: Serialization framework / 序列化框架



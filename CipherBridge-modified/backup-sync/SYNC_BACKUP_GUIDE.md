# 远程工作内容同步到本地 —— 操作指导

> 目的：把你在智星云实例上的“工作成果”（改过的代码、`deployments.json`、运行日志、git 状态）定时或手动**打包下载到本地电脑**，防止实例被重置/释放导致丢失。
> 适用：本地 Windows + Trae；远端 = 智星云 Ubuntu 实例。

## 1. 文件清单

| 文件 | 放哪 | 作用 |
|---|---|---|
| `backup_zhixing.sh` | 本地与云端各一份（脚本会自动上传） | 云端打包工作成果 |
| `pull_backup.ps1` | 本地（与上面 .sh 同目录） | 一键：上传→打包→下载→解压→记日志 |
| `SYNC_BACKUP_GUIDE.md` | 本地 | 本文档 |

## 2. 第一次使用（3 步）

**① 修改参数**：编辑 `pull_backup.ps1` 顶部三个占位参数，或在命令里传入：
```powershell
# 推荐：运行时传参（不改文件）
powershell -ExecutionPolicy Bypass -File E:\workspace\Bisai\backup-sync\pull_backup.ps1 `
  -HostName <公网IP> -Port <SSH端口> -User root
```

**② 运行**（会在登录提示时输密码，共约 3 次：上传、执行、读路径）
```powershell
powershell -ExecutionPolicy Bypass -File E:\workspace\Bisai\backup-sync\pull_backup.ps1 -HostName 1.2.3.4 -Port 2233 -User root
```

**③ 确认结果**
```text
压缩包 : C:\Users\<你>\CipherBridge_backups\cipherbridge_20260908_120000.tar.gz
代码目录: C:\Users\<你>\CipherBridge_backups\Bisai
日志清单: C:\Users\<你>\CipherBridge_backups\logs
同步历史: C:\Users\<你>\CipherBridge_backups\sync_history.log
```
> 若提示“无法将 scp 识别为命令”：先确认 Windows 已启用 OpenSSH 客户端（设置→应用→可选功能→OpenSSH 客户端），或使用 Git Bash 里的 ssh/scp。

## 3. 备份内容与排除项

| 包含 | 说明 |
|---|---|
| `/root/Bisai` 全部仓库源码与改动 | FHE-API / FHE-Frontend / FHE-Protocol / 两个 ZK demo |
| `deployments.json` | 最新合约地址 |
| `logs/` | `/tmp` 下 fhe_build / fhe_api / chain / web 日志 + tmux 会话 |
| `logs/manifest.txt` | 各仓库 `git status`、最近提交、部署地址快照 |

默认**排除**（想全量备份加 `--full`，脚本已支持）：
`node_modules`、cargo `target`、`.git`、`tfhe-rs-main`（本地要完整可运行环境时，可再单独把这些目录 scp 回）。

## 4. 常用场景

```powershell
# 场景A：手动备份一次
# 场景B：先看云端有什么再决定
ssh -p <端口> root@<IP> "ls -lht /root/backups | head"
# 场景C：只打包不下载（在云端手动执行）
bash /root/backup_zhixing.sh
bash /root/backup_zhixing.sh --full      # 全量
# 场景D：只下载最新一份（手动，云端已打包过）
scp -P <端口> root@<IP>:/root/backups/cipherbridge_最新.tar.gz C:\Users\<你>\CipherBridge_backups\
```

## 5.（可选）设置每天自动备份

1. Windows 搜索“任务计划程序”→“创建基本任务”；
2. 触发器：每天某时刻；操作：启动程序；
3. 程序：`powershell.exe`
   参数：`-ExecutionPolicy Bypass -File "E:\workspace\Bisai\backup-sync\pull_backup.ps1" -HostName <IP> -Port <端口> -User root`
4. 若要无人值守，请先给实例配置 **SSH 公钥免密登录**（否则会卡在输密码）。

## 6. 安全提醒

- 备份里包含**代码**与 `hardhat.config.js` 中已提交的测试私钥等；请存放在个人电脑并加密/不共享。
- FHE-API 的用户密钥只存在于云端内存，**不在本备份里**；如需保全请在 `generate_keys` 后自行导出 client_key（该 key 勿外传）。

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| 要输 3 次密码 | 正常（上传/执行/读路径各一次）；配免密即可一次搞定 |
| `ssh/scp/tar 不是内部命令` | 开启 Windows“OpenSSH 客户端”；tar 需 Win10 1803+ |
| 云端报 `[FATAL] 找不到 /root/Bisai` | 先传代码再备份；或修改脚本里 `ROOT=` |
| 备份很大/很慢 | 默认已排除大目录；还慢就用精简模式，或加 `--full` 仅在需要时 |
| 解压后没有 Bisai 目录 | 查看解压是否成功；Windows tar 解压后应出现 `Bisai/` 与 `logs/` |
| 想看历史备份记录 | `Get-Content C:\Users\<你>\CipherBridge_backups\sync_history.log` |

## 8. 恢复提示（把备份导回实例）
```powershell
# 本地 → 云端：解压后把 Bisai 目录传回即可
scp -P <端口> -r C:\Users\<你>\CipherBridge_backups\Bisai root@<IP>:/root/
```
回到云端后按 `E:\workspace\Bisai\remote-setup\ZHIXINGYUN_GUIDE.md`「附 A：断点续跑」处理（实例重启需重部署，见脚本 `E:\workspace\Bisai\remote-setup\resume_zhixing.sh`）。

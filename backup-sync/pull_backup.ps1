<#
============================================================================
 pull_backup.ps1 — 把智星云实例上的“工作成果”同步到本地电脑
 依赖：Windows 自带 OpenSSH(scp/ssh/tar)；脚本与 backup_zhixing.sh 放同目录
 用法（PowerShell）：
   # 直接编辑下方参数，或运行时传入：
   powershell -ExecutionPolicy Bypass -File E:\workspace\Bisai\pull_backup.ps1
   powershell -ExecutionPolicy Bypass -File E:\workspace\Bisai\pull_backup.ps1 -HostName 1.2.3.4 -Port 22 -User root
 流程：上传云端备份脚本 -> 云端打包 -> 下载 tar.gz -> 本地解压 -> 写历史日志
============================================================================
#>
param(
  [string]$HostName = "CHANGE_ME",          # 智星云公网 IP
  [int]$Port = 22,                          # SSH 端口
  [string]$User = "root",                   # 登录用户名
  [string]$LocalBackupDir = "$env:USERPROFILE\CipherBridge_backups"
)
$ErrorActionPreference = 'Stop'
$ssh = "${User}@${HostName}"

function Step($m) { Write-Host ""; Write-Host "===== $m =====" }

# 0) 上传云端备份脚本（保持最新版本）
Step "0) 上传 backup_zhixing.sh 到云端"
$localSh = Join-Path $PSScriptRoot 'backup_zhixing.sh'
if (-not (Test-Path $localSh)) { throw "找不到本地脚本: $localSh" }
scp -P $Port $localSh "${ssh}:/root/backup_zhixing.sh"
if ($LASTEXITCODE -ne 0) { throw "上传云端备份脚本失败 (exit $LASTEXITCODE)" }

# 1) 云端执行备份
Step "1) 云端执行备份脚本"
ssh -p $Port $ssh "bash /root/backup_zhixing.sh"
if ($LASTEXITCODE -ne 0) { throw "云端备份执行失败 (exit $LASTEXITCODE)，请先在云端查看原因" }

# 2) 读取最新备份文件路径
Step "2) 读取云端最新备份路径"
$remote = ((ssh -p $Port $ssh "cat /root/backups/LATEST.txt" 2>$null) | Select-Object -First 1).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remote)) {
  throw "无法读取 /root/backups/LATEST.txt"
}
Write-Host "  远程备份: $remote"

# 3) 下载
Step "3) 下载到本地"
New-Item -ItemType Directory -Force -Path $LocalBackupDir | Out-Null
$name   = Split-Path $remote -Leaf
$localTgz = Join-Path $LocalBackupDir $name
scp -P $Port "${ssh}:$remote" $localTgz
if ($LASTEXITCODE -ne 0) { throw "下载失败 (exit $LASTEXITCODE)" }
Write-Host "  已下载: $localTgz"

# 4) 解压
Step "4) 解压到本地备份目录"
Push-Location $LocalBackupDir
tar -xzf $name
$rc = $LASTEXITCODE
Pop-Location
if ($rc -ne 0) { throw "解压失败(exit $rc)——Win10 以上自带 tar，请确认系统版本" }

# 5) 写历史日志
Step "5) 记录同步历史"
$line = "{0}  <-  {1} : {2}  ({3} bytes)" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $HostName, $remote, (Get-Item $localTgz).Length
Add-Content (Join-Path $LocalBackupDir 'sync_history.log') -Value $line

Write-Host ""
Write-Host "======================== 完成 ========================"
Write-Host "压缩包 : $localTgz"
Write-Host "代码目录: $LocalBackupDir\Bisai"
Write-Host "日志清单: $LocalBackupDir\logs   (manifest.txt 记录 git 状态与部署地址)"
Write-Host "同步历史: $LocalBackupDir\sync_history.log"
Write-Host "======================================================"

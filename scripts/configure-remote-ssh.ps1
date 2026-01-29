Param(
  [Parameter(Mandatory=$true)][Alias('Host')][string]$SSHHost,
  [Parameter(Mandatory=$true)][string]$User,
  [int]$Port = 22,
  [string]$Dest = "/root/livechat-app",
  [string]$AdminToken = "",
  [switch]$PruneOrphans,
  [switch]$PurgeInactive,
  [switch]$SyncEnv
)

$ErrorActionPreference = 'Stop'

Write-Host "[configure-remote-ssh] Host=$SSHHost User=$User Port=$Port Dest=$Dest"

$cfg = [ordered]@{
  host = $SSHHost
  user = $User
  port = $Port
  dest = $Dest
  admin_token = $AdminToken
  prune_orphans = [bool]$PruneOrphans
  purge_inactive = [bool]$PurgeInactive
  sync_env = [bool]$SyncEnv
}

$cfgPath = Join-Path $PSScriptRoot 'remote-ssh.json'
$cfg | ConvertTo-Json -Depth 5 | Out-File -FilePath $cfgPath -Encoding UTF8 -Force
Write-Host "[configure-remote-ssh] Saved $cfgPath"

Write-Host "[configure-remote-ssh] You can now run: powershell -NoProfile -ExecutionPolicy Bypass -Command \"& '$PSScriptRoot/sync-and-deploy.ps1'\""

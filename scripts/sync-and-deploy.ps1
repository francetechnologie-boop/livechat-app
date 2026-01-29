Param(
  [Alias('Host')][string]$SSHHost,
  [string]$User,
  [int]$Port,
  [string]$Dest,
  [string]$AdminToken,
  [switch]$PruneOrphans,
  [switch]$PurgeInactive,
  [switch]$SyncEnv
)

$ErrorActionPreference = 'Stop'

function Convert-ToMsysPath {
  Param([Parameter(Mandatory=$true)][string]$WindowsPath)
  $p = $WindowsPath -replace '\\','/'
  if ($p -match '^[A-Za-z]:') {
    $drive = $p.Substring(0,1).ToLower()
    $rest = $p.Substring(2)
    return "/$drive/$rest"
  }
  return $p
}

# Load config if present
$cfgPath = Join-Path $PSScriptRoot 'remote-ssh.json'
$cfg = $null
if (Test-Path $cfgPath) {
  try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json } catch {}
}

function Get-CfgVal($name,$fallback) {
  if ($PSBoundParameters.ContainsKey($name) -and $PSBoundParameters[$name]) { return $PSBoundParameters[$name] }
  if ($cfg -and ($cfg | Get-Member -Name $name -MemberType NoteProperty)) { return $cfg.$name }
  return $fallback
}

$SSH_HOST = Get-CfgVal 'host' $SSHHost
$SSH_USER = Get-CfgVal 'user' $User
$SSH_PORT = Get-CfgVal 'port' ($(if ($Port) { $Port } else { 22 }))
$DEST     = Get-CfgVal 'dest' $Dest
$ADMIN    = Get-CfgVal 'admin_token' $AdminToken
$PO       = Get-CfgVal 'prune_orphans' ([bool]$PruneOrphans)
$PI       = Get-CfgVal 'purge_inactive' ([bool]$PurgeInactive)
$SE       = Get-CfgVal 'sync_env' ([bool]$SyncEnv)

if (-not $SSH_HOST -or -not $SSH_USER -or -not $DEST) {
  Write-Error "Missing SSH parameters. Use scripts/configure-remote-ssh.ps1 to set them or pass -Host/-User/-Dest."
}

# Locate bash
$bash = $null
try { $bash = (Get-Command bash -ErrorAction Stop).Source } catch {}
if (-not $bash) {
  $candidate = 'C:\Program Files\Git\bin\bash.exe'
  if (Test-Path $candidate) { $bash = $candidate }
}
if (-not $bash) { throw "bash not found. Install Git for Windows or WSL." }

# Repo root: this script is at livechat-app/scripts, repo root is two levels up
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$RepoRootUnix = Convert-ToMsysPath $RepoRoot.Path

# Build env assignment string for bash
$envs = @()
$envs += "SSH_HOST='$SSH_HOST'"
$envs += "SSH_USER='$SSH_USER'"
$envs += "SSH_PORT='$SSH_PORT'"
$envs += "DEST='$DEST'"
if ($ADMIN) { $envs += "ADMIN_TOKEN='$ADMIN'" }
if ($PO)    { $envs += "PRUNE_ORPHANS=1" }
if ($PI)    { $envs += "PURGE_INACTIVE=1" }
if ($SE)    { $envs += "SYNC_ENV=1" }
$envStr = $envs -join ' '

Write-Host "[sync] Using bash at: $bash"
Write-Host "[sync] Repo root (unix): $RepoRootUnix"
Write-Host "[sync] Running: $envStr ./sync+deploy.sh"

$cmd = "cd '$RepoRootUnix' && $envStr ./sync+deploy.sh"
& $bash -lc $cmd

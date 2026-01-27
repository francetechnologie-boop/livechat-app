# Wrapper that calls the workspace-level snapshot script.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# Workspace root is one level up from livechat-app
$Root = Split-Path -Parent $ScriptDir
$WorkspaceRoot = Split-Path -Parent $Root

$TopLevelScript = Join-Path $WorkspaceRoot 'scripts/snapshot-before-sync.ps1'
if (-not (Test-Path -LiteralPath $TopLevelScript)) {
  Write-Error "Snapshot script not found at '$TopLevelScript'"
}

& $TopLevelScript


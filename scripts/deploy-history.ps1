# Wrapper to call the repo-level script; allows running from livechat-app folder
param(
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$Rest
)

$current = Split-Path -Parent $MyInvocation.MyCommand.Path  # .../livechat-app/scripts
# Prefer repo-level script two levels up: livechat-app/.. (repo root)/scripts/deploy-history.ps1
$repoScriptsRoot = Join-Path (Join-Path (Join-Path $current '..') '..') 'scripts\deploy-history.ps1'
$fallbackInLivechat = Join-Path (Join-Path $current '..') 'scripts\deploy-history.ps1'

if (Test-Path $repoScriptsRoot) {
  & $repoScriptsRoot @Rest
  exit $LASTEXITCODE
}
elseif (Test-Path $fallbackInLivechat) {
  # Avoid self-recursion: only exec if target is not this wrapper
  $self = (Resolve-Path $MyInvocation.MyCommand.Path).Path
  $target = (Resolve-Path $fallbackInLivechat).Path
  if ($self -ieq $target) { Write-Error 'Wrapper recursion detected'; exit 1 }
  & $fallbackInLivechat @Rest
  exit $LASTEXITCODE
}
else {
  Write-Error "deploy-history.ps1 not found (looked in ../scripts and scripts)"
  exit 1
}

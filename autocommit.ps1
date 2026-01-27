param(
  [string]$RepoPath = "G:\00_DEVELLOPEMENT\TESTVPS\livechat-app\livechat-app",
  [string]$Branch   = "main",
  [string]$Remote   = "origin"
)

$timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$logFile   = Join-Path $RepoPath "autocommit.log"

Set-Location $RepoPath

# sanity checks
git rev-parse --is-inside-work-tree 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  "[$timestamp] Not a git repo: $RepoPath" | Out-File -FilePath $logFile -Append
  exit 1
}

# stage & commit only if there are changes (respects .gitignore)
$changes = git status --porcelain
if ($changes) {
  git add -A
  $staged = git diff --cached --name-only
  if ($staged) {
    $msg = "chore(auto): autocommit at $timestamp"
    git commit -m $msg
    "[$timestamp] Committed: $msg" | Out-File -FilePath $logFile -Append
  }
}

# rebase on top of remote (avoid merge commits)
git fetch $Remote $Branch *> $null
git pull --rebase $Remote $Branch
if ($LASTEXITCODE -ne 0) {
  git rebase --abort 2>$null
  "[$timestamp] Rebase failed; manual intervention needed." | Out-File -FilePath $logFile -Append
  exit 2
}

# push if there’s anything ahead
$ahead = git rev-list "@{u}..HEAD" 2>$null
if ($LASTEXITCODE -eq 0 -and $ahead) {
  git push $Remote $Branch
  "[$timestamp] Pushed to $Remote/$Branch" | Out-File -FilePath $logFile -Append
} else {
  "[$timestamp] Nothing to push" | Out-File -FilePath $logFile -Append
}

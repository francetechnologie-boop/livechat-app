#!/usr/bin/env bash
set -euo pipefail

# Wrapper that calls the repo-level script. Keeps tasks working even if run
# from the livechat-app workspace folder.
REPOROOT="$(cd "$(dirname "$0")"/.. && pwd)"
if [ -x "$REPOROOT/../scripts/deploy-history.sh" ]; then
  exec "$REPOROOT/../scripts/deploy-history.sh" "$@"
elif [ -x "$REPOROOT/scripts/deploy-history.sh" ]; then
  exec "$REPOROOT/scripts/deploy-history.sh" "$@"
else
  echo "deploy-history.sh not found (looked in repo scripts/)" >&2
  exit 1
fi


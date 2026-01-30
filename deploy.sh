#!/usr/bin/env bash





set -euo pipefail

### ---------- DEPLOY LOG ----------
# Keep a persistent deploy log for debugging "stuck" installs/builds.
# Can be disabled with NO_DEPLOY_LOG=1.
if [ -z "${NO_DEPLOY_LOG:-}" ]; then
  # If APP_ROOT isn't known yet, log into the current working dir; later steps `cd` into APP_ROOT.
  DEPLOY_LOG_FILE="${DEPLOY_LOG:-$(pwd)/deploy.log}"
  # Append, but separate runs.
  {
    echo
    echo "----- deploy start: $(date -u +'%Y-%m-%dT%H:%M:%SZ') -----"
  } >>"$DEPLOY_LOG_FILE" 2>/dev/null || true
  exec > >(tee -a "$DEPLOY_LOG_FILE") 2>&1
fi

### ---------- ENV / PATH ----------
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
# Ensure Playwright downloads browsers into project-local cache by default
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
# Load nvm if you use it
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
fi

### ---------- LOCATIONS ----------
cd "$(dirname "$0")"
APP_ROOT="$(pwd)"
BACKEND="$APP_ROOT/backend"
FRONTEND="$APP_ROOT/frontend"

# Make npm installs lighter/more reliable on small VPSes unless explicitly overridden.
# (The server can be memory constrained; npm audit/fund can add noticeable overhead.)
export npm_config_audit="${npm_config_audit:-false}"
export npm_config_fund="${npm_config_fund:-false}"
export npm_config_progress="${npm_config_progress:-false}"

# Default to low parallelism when the machine is under memory pressure.
if [ -z "${npm_config_jobs:-}" ]; then
  AVAIL_KB=$(awk '/MemAvailable:/ {print $2+0}' /proc/meminfo 2>/dev/null || echo 0)
  if [ "${AVAIL_KB}" -gt 0 ] && [ "${AVAIL_KB}" -lt 800000 ]; then
    export npm_config_jobs=2
  fi
fi

# If the project was uploaded as a nested folder (common with SFTP uploading the local
# "livechat-app/" directory into "$APP_ROOT"), overlay it into the real deploy root.
# This keeps PM2 running code in "$APP_ROOT/{backend,frontend,modules}" in sync with uploads.
NESTED_APP="$APP_ROOT/livechat-app"
if [ -z "${MERGE_NESTED_APP:-}" ] || [ "${MERGE_NESTED_APP:-}" = "1" ]; then
  if [ -d "$NESTED_APP" ] && { [ -d "$NESTED_APP/backend" ] || [ -d "$NESTED_APP/frontend" ] || [ -d "$NESTED_APP/modules" ]; }; then
    echo "[deploy] Found nested app dir at livechat-app/; overlaying into deploy root"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a "$NESTED_APP/" "$APP_ROOT/" \
        --exclude '/backend/.env' \
        --exclude '/node_modules/' \
        --exclude '/backend/node_modules/' \
        --exclude '/frontend/node_modules/' \
        --exclude '/.git/' \
        --exclude '/.history/' \
        >/dev/null 2>&1 || true
    else
      # Best-effort tar fallback (no deletes).
      ( cd "$NESTED_APP" && tar -cf - . 2>/dev/null ) | ( cd "$APP_ROOT" && tar -xf - 2>/dev/null ) || true
    fi
    echo "[deploy] Nested overlay complete (set MERGE_NESTED_APP=0 to disable)"
  fi
fi

# If a nested .env was synced (livechat-app/backend/.env), mirror it to backend/.env
if [ -f "$APP_ROOT/livechat-app/backend/.env" ]; then
  echo "[deploy] Found nested .env at livechat-app/backend/.env (remote)"
  ls -l "$APP_ROOT/livechat-app/backend/.env" || true
  echo "[deploy] backend/.env BEFORE copy:"; ls -l "$BACKEND/.env" || true
  echo "[deploy] Copying nested .env → backend/.env"
  cp -f "$APP_ROOT/livechat-app/backend/.env" "$BACKEND/.env"
  echo "[deploy] backend/.env AFTER copy:"; ls -l "$BACKEND/.env" || true
  echo "[deploy] Removing nested .env to avoid confusion going forward"
  rm -f "$APP_ROOT/livechat-app/backend/.env" || true
fi

# Show key GOOGLE_OAUTH_* lines (masking secrets) only when present (avoid failing under pipefail)
if [ -f "$BACKEND/.env" ]; then
  # Collect matches safely; grep returns 1 when no matches, which would fail under pipefail
  MATCHES=$(grep -E '^(GOOGLE_OAUTH_|OIDC_CLIENT_ID=)' "$BACKEND/.env" 2>/dev/null | sed -e 's/GOOGLE_OAUTH_CLIENT_SECRET=.*/GOOGLE_OAUTH_CLIENT_SECRET=***masked***/' || true)
  if [ -n "$MATCHES" ]; then
    echo "[deploy] backend/.env — GOOGLE_OAUTH_* (masked):"
    printf '%s\n' "$MATCHES"
  fi
else
  echo "[deploy] backend/.env not found"
fi

### ---------- SAVE CHANGED FILES (pre-deploy, no zip) ----------
# Snapshot local changes by copying changed files to a timestamped directory.
# Controls:
#   SKIP_SAVE_CHANGED=1   to disable
#   SAVE_DEST_DIR=/path    override backup root (default /root/livechat-app-backup)
if [ -z "${SKIP_SAVE_CHANGED:-}" ]; then
  BACKUP_ROOT_DEFAULT="/root/livechat-app-backup"
  BACKUP_ROOT="${SAVE_DEST_DIR:-$BACKUP_ROOT_DEFAULT}"
  mkdir -p "$BACKUP_ROOT" 2>/dev/null || true
  TS_CHG="$(date '+%Y-%m-%d %H-%M-%S')"
  CHANGES_DIR="$BACKUP_ROOT/changes-$TS_CHG"
  echo "[deploy] Saving changed files (no zip) to: $CHANGES_DIR"

  saved_any=0
  ensure_copy() {
    src="$1"
    dest_dir="$CHANGES_DIR/$(dirname "$1")"
    mkdir -p "$dest_dir" 2>/dev/null || true
    cp -a "$src" "$CHANGES_DIR/$1" 2>/dev/null && saved_any=1 || true
  }

  # Prefer git if available and repo is initialized
  if command -v git >/dev/null 2>&1 && [ -d "$APP_ROOT/.git" ]; then
    pushd "$APP_ROOT" >/dev/null
    CHANGED_LIST=$(git status --porcelain --untracked-files=all | awk '{print $2}' | sed '/^$/d') || CHANGED_LIST=
    if [ -n "$CHANGED_LIST" ]; then
      while IFS= read -r f; do
        [ -e "$f" ] || continue
        ensure_copy "$f"
      done <<EOF
$CHANGED_LIST
EOF
    else
      echo "[deploy] No local changes detected by git"
    fi
    popd >/dev/null
  else
    # Fallback: compare against previous snapshot of mtimes+sizes
    SNAP_FILE="$APP_ROOT/.deploy.snapshot"
    NEW_SNAP="$APP_ROOT/.deploy.snapshot.new"
    (
      cd "$APP_ROOT" && \
      find . -type f \( -path './.git/*' -o -path './node_modules/*' -o -path './frontend/node_modules/*' -o -path './backend/node_modules/*' \) -prune -o -type f -print0 | \
      xargs -0 stat -c '%n|%s|%Y' | sort > "$NEW_SNAP"
    )
    if [ -f "$SNAP_FILE" ]; then
      CHANGED_LIST=$(diff -u "$SNAP_FILE" "$NEW_SNAP" | awk -F'|' '/^\+[^+]/ {print substr($1,2)}' | sed '/^$/d') || CHANGED_LIST=
    else
      CHANGED_LIST=$(awk -F'|' '{print $1}' "$NEW_SNAP")
    fi
    mv -f "$NEW_SNAP" "$SNAP_FILE" >/dev/null 2>&1 || true
    if [ -n "$CHANGED_LIST" ]; then
      while IFS= read -r f; do
        fp="${f#./}"
        [ -e "$APP_ROOT/$fp" ] || continue
        ensure_copy "$fp"
      done <<EOF
$CHANGED_LIST
EOF
    fi
  fi

  if [ "$saved_any" = 1 ]; then
    echo "[deploy] Saved changed files to: $CHANGES_DIR"
  else
    echo "[deploy] No changed files to snapshot"
    rmdir "$CHANGES_DIR" 2>/dev/null || true
  fi
fi

### ---------- SINGLE RUN LOCK ----------
# Prevent concurrent deploys.
LOCK_FILE="${LOCK_FILE:-/var/lock/livechat-deploy.lock}"
if ! mkdir -p "$(dirname "$LOCK_FILE")" >/dev/null 2>&1; then
  LOCK_FILE="$APP_ROOT/.deploy.lock"
fi
if [ -z "${DEPLOY_LOCKED:-}" ]; then
  if [ -n "${SKIP_LOCK:-}" ]; then
    echo "[deploy] SKIP_LOCK=1 — skipping deploy lock"
    exec env DEPLOY_LOCKED=1 bash "$0" "$@"
  fi
  : > "$LOCK_FILE" 2>/dev/null || true
  echo "[deploy] Acquiring lock: $LOCK_FILE"
  if command -v flock >/dev/null 2>&1; then
    if [ -n "${DEPLOY_LOCK_WAIT:-}" ]; then
      if flock -w "${DEPLOY_LOCK_WAIT}" "$LOCK_FILE" env DEPLOY_LOCKED=1 bash "$0" "$@"; then exit 0; fi
      echo "[deploy] ERROR: deploy lock busy after ${DEPLOY_LOCK_WAIT}s ($LOCK_FILE)" >&2
      exit 1
    fi
    if flock -n "$LOCK_FILE" env DEPLOY_LOCKED=1 bash "$0" "$@"; then exit 0; fi
    echo "[deploy] ERROR: deploy lock busy ($LOCK_FILE). Set DEPLOY_LOCK_WAIT=300 to wait." >&2
    exit 1
  fi

  # Fallback if flock isn't installed: lock via mkdir (best-effort)
  LOCK_DIR="${LOCK_FILE}.d"
  if [ -n "${DEPLOY_LOCK_WAIT:-}" ]; then
    end=$(( $(date +%s) + DEPLOY_LOCK_WAIT ))
    while ! mkdir "$LOCK_DIR" 2>/dev/null; do
      if [ "$(date +%s)" -ge "$end" ]; then
        echo "[deploy] ERROR: deploy lock busy after ${DEPLOY_LOCK_WAIT}s ($LOCK_DIR)" >&2
        exit 1
      fi
      sleep 1
    done
  else
    if ! mkdir "$LOCK_DIR" 2>/dev/null; then
      echo "[deploy] ERROR: deploy lock busy ($LOCK_DIR). Set DEPLOY_LOCK_WAIT=300 to wait." >&2
      exit 1
    fi
  fi
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
  exec env DEPLOY_LOCKED=1 bash "$0" "$@"
fi

PM2_NAME="${PM2_NAME:-livechat}"   # fallback name
APP_PORT="${PORT:-3010}"           # curl test uses this
# If PORT not in shell env, try reading backend/.env for PORT
if [ -z "${PORT:-}" ] && [ -f "$BACKEND/.env" ]; then
  ENV_PORT=$(grep -E '^PORT=' "$BACKEND/.env" | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"\|"$//g' -e "s/^'\|'$//g") || true
  if [ -n "$ENV_PORT" ]; then APP_PORT="$ENV_PORT"; fi
fi

log(){ printf '\n[deploy] %s\n' "$*"; }
die(){ echo "[deploy] ERROR: $*" >&2; exit 1; }

### ---------- MIRROR MODULES DIRECTORY (optional, destructive) ----------
# Ensure the server's modules/ folder matches the current source by deleting
# stale/untracked entries left behind by previous uploads. Disabled by default.
# Enable with:
#   SYNC_MIRROR_MODULES=1           # perform cleanup
# Optional knobs:
#   MIRROR_DRY_RUN=1                # show what would be deleted (git only)
#   MODULES_MANIFEST=path/to/list   # newline-separated list of module ids to keep (no git)
#   MIRROR_NO_GIT_DELETE_NO_MANIFEST=1  # without git, delete dirs missing config.json/manifest.json/module.config.json
#   MIRROR_PROTECT=1                # (default) never delete 'module-manager','agents','logs2' unless MIRROR_FORCE=1
#   MIRROR_FORCE=1                  # allow deletion of protected dirs

if [ -n "${SYNC_MIRROR_MODULES:-}" ]; then
  log "Mirror: checking modules directory for stale content"
  MOD_DIR="$APP_ROOT/modules"
  if [ ! -d "$MOD_DIR" ]; then
    log "Mirror: modules dir not found; skipping"
  else
    PROTECT_LIST="module-manager agents logs2"
    if [ -d "$APP_ROOT/.git" ] && command -v git >/dev/null 2>&1; then
      pushd "$APP_ROOT" >/dev/null
      if [ -n "${MIRROR_DRY_RUN:-}" ]; then
        log "Mirror (dry-run): git clean -fdxn modules"
        git clean -fdxn modules || true
      else
        log "Mirror: deleting untracked files in modules via git clean"
        # Optionally protect critical dirs by adding them to .git/info/exclude temporarily
        if [ -z "${MIRROR_FORCE:-}" ] && [ -n "${MIRROR_PROTECT:-1}" ]; then
          EXCL_FILE=".git/info/exclude"
          TMP_MARK="# deploy.sh mirror protect"
          # Build a temporary exclude list
          {
            echo "$TMP_MARK"
            for p in $PROTECT_LIST; do echo "modules/$p/"; done
          } >> "$EXCL_FILE" 2>/dev/null || true
          git clean -fdx modules || true
          # Remove the temporary lines we added
          if [ -f "$EXCL_FILE" ]; then
            awk -v mark="$TMP_MARK" '{ if ($0 == mark) exit; print }' "$EXCL_FILE" > "$EXCL_FILE.tmp" 2>/dev/null || true
            mv -f "$EXCL_FILE.tmp" "$EXCL_FILE" 2>/dev/null || true
          fi
        else
          git clean -fdx modules || true
        fi
      fi
      popd >/dev/null
    else
      # No git available: use manifest or heuristic
      if [ -n "${MODULES_MANIFEST:-}" ] && [ -f "$MODULES_MANIFEST" ]; then
        log "Mirror: manifest mode using $MODULES_MANIFEST"
        mapfile -t KEEP < <(grep -vE '^\s*(#|$)' "$MODULES_MANIFEST" | tr -d '\r' | sed 's/\s\+$//')
        for d in "$MOD_DIR"/*; do
          [ -d "$d" ] || continue
          base="$(basename "$d")"
          keep=0
          for k in "${KEEP[@]}"; do [ "$base" = "$k" ] && keep=1 && break; done
          if [ "$keep" -eq 0 ]; then
            if [ -z "${MIRROR_FORCE:-}" ] && [ -n "${MIRROR_PROTECT:-1}" ]; then
              for p in $PROTECT_LIST; do [ "$base" = "$p" ] && keep=1; done
            fi
            if [ "$keep" -eq 0 ]; then
              log "Mirror: removing stale module dir $base (manifest)"
              rm -rf "$d"
            fi
          fi
        done
      elif [ -n "${MIRROR_NO_GIT_DELETE_NO_MANIFEST:-}" ]; then
        log "Mirror: deleting module dirs with no manifest (config.json/manifest.json/module.config.json)"
        for d in "$MOD_DIR"/*; do
          [ -d "$d" ] || continue
          base="$(basename "$d")"
          if [ -z "${MIRROR_FORCE:-}" ] && [ -n "${MIRROR_PROTECT:-1}" ]; then
            for p in $PROTECT_LIST; do [ "$base" = "$p" ] && continue 2; done
          fi
          if [ ! -f "$d/config.json" ] && [ ! -f "$d/manifest.json" ] && [ ! -f "$d/module.config.json" ]; then
            log "Mirror: removing $base (no manifest)"
            rm -rf "$d"
          fi
        done
      else
        log "Mirror: no git and no manifest/heuristic requested; skipping"
      fi
    fi
  fi
fi

# Generic mirroring for additional folders (git clean based)
# Provide a space/comma-separated list in SYNC_MIRROR_DIRS, e.g.:
#   SYNC_MIRROR_DIRS="frontend/src/modules pages tmp_module"
# This uses `git clean -fdx` scoped to those paths. Use MIRROR_DRY_RUN=1 to preview.
if [ -n "${SYNC_MIRROR_DIRS:-}" ]; then
  log "Mirror: additional dirs requested: ${SYNC_MIRROR_DIRS}"
  if [ -d "$APP_ROOT/.git" ] && command -v git >/dev/null 2>&1; then
    # Normalize separators to spaces
    TO_MIRROR=$(printf '%s' "$SYNC_MIRROR_DIRS" | tr ',;' '  ')
    pushd "$APP_ROOT" >/dev/null
    if [ -n "${MIRROR_DRY_RUN:-}" ]; then
      log "Mirror (dry-run): git clean -fdxn -- $TO_MIRROR"
      # shellcheck disable=SC2086
      git clean -fdxn -- $TO_MIRROR || true
    else
      log "Mirror: deleting untracked in: $TO_MIRROR"
      # shellcheck disable=SC2086
      git clean -fdx -- $TO_MIRROR || true
    fi
    popd >/dev/null
  else
    log "Mirror: SYNC_MIRROR_DIRS requires a git checkout on server; skipping"
  fi
fi

### ---------- REMOTE BACKUP (throttled) ----------
# By default, create a backup once every 10 deploy runs.
# Tweak with env vars:
#   BACKUP_EVERY=N   (default 10; set 1 to backup every run)
#   ALWAYS_BACKUP=1  (force backup this run)
#   SKIP_BACKUP=1    (skip backup this run)
#   COUNT_FILE=...   (optional custom counter path)

BACKUP_EVERY=${BACKUP_EVERY:-10}
COUNT_DIR="$(dirname "$LOCK_FILE")"
COUNT_FILE=${COUNT_FILE:-"$COUNT_DIR/livechat-deploy.count"}
if ! mkdir -p "$COUNT_DIR" >/dev/null 2>&1; then
  COUNT_FILE="$APP_ROOT/.deploy.count"
fi

# Read and increment counter
DEPLOY_COUNT=0
if [ -f "$COUNT_FILE" ]; then
  DEPLOY_COUNT=$(cat "$COUNT_FILE" 2>/dev/null | tr -d '\r' || echo 0)
fi
case "$DEPLOY_COUNT" in ''|*[!0-9]*) DEPLOY_COUNT=0 ;; esac
DEPLOY_COUNT=$((DEPLOY_COUNT + 1))
printf '%s' "$DEPLOY_COUNT" > "$COUNT_FILE" || true

DO_BACKUP=0
if [ -n "${ALWAYS_BACKUP:-}" ]; then
  DO_BACKUP=1
elif [ -n "${SKIP_BACKUP:-}" ]; then
  DO_BACKUP=0
else
  # If BACKUP_EVERY <= 1, back up every run
  if [ "${BACKUP_EVERY:-10}" -le 1 ]; then
    DO_BACKUP=1
  else
    REM=$(( DEPLOY_COUNT % BACKUP_EVERY ))
    if [ "$REM" -eq 0 ]; then DO_BACKUP=1; fi
  fi
fi

if [ "$DO_BACKUP" = "1" ]; then
  echo "[deploy][step] Code backup — START"
  if ! command -v zip >/dev/null 2>&1; then
    die "'zip' command not found; install the zip package to enable backups"
  fi
  BACKUP_ROOT="/root/livechat-app-backup"
  mkdir -p "$BACKUP_ROOT"
  BACKUP_TS="$(date '+%Y-%m-%d %H-%M-%S')"
  BACKUP_BASENAME="$BACKUP_TS livechat-app-backup.zip"
  BACKUP_FILE="$BACKUP_ROOT/$BACKUP_BASENAME"
  log "Creating backup archive: $BACKUP_FILE (deploy #$DEPLOY_COUNT; every $BACKUP_EVERY)"
  if ! ( cd "$APP_ROOT" && zip -r "$BACKUP_FILE" . >/dev/null ); then
    die "Backup archive creation failed"
  fi
  log "Backup complete"

  # Database backup (disabled by default). Set ENABLE_DB_DUMP=1 to enable.
  if [ -n "${ENABLE_DB_DUMP:-}" ]; then
    DBURL="${DATABASE_URL:-}"
    if [ -z "$DBURL" ] && [ -f "$BACKEND/.env" ]; then
      DBURL=$(grep -E '^DATABASE_URL=' "$BACKEND/.env" | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"\|"$//g' -e "s/^'\|'$//g") || true
    fi
    if [ -n "$DBURL" ] && command -v pg_dump >/dev/null 2>&1; then
      DB_TS="$(date -u +%Y%m%dT%H%M%SZ)"
      DB_DUMP_FILE="$BACKUP_ROOT/livechat_${DB_TS}.dump"
      log "DB: creating dump $DB_DUMP_FILE"
      if ! pg_dump -d "$DBURL" -Fc -Z9 -f "$DB_DUMP_FILE" >/dev/null 2>&1; then
        log "DB: pg_dump failed; skipping DB backup"
        rm -f "$DB_DUMP_FILE" >/dev/null 2>&1 || true
      else
  log "DB: dump complete"
        # Optional retention: delete DB dumps older than 7 days
        OLD_DB=$(find "$BACKUP_ROOT" -type f -name 'livechat_*.dump' -mtime +7 -print 2>/dev/null | wc -l | tr -d ' ') || OLD_DB=0
        find "$BACKUP_ROOT" -type f -name 'livechat_*.dump' -mtime +7 -delete >/dev/null 2>&1 || true
        log "Retention: deleted ${OLD_DB} DB dumps older than 7 days"
      fi
    else
      if [ -z "$DBURL" ]; then log "DB: DATABASE_URL not found; skipping DB backup"; fi
      if ! command -v pg_dump >/dev/null 2>&1; then log "DB: 'pg_dump' not found; skipping DB backup"; fi
    fi
  else
    log "DB: dump disabled (set ENABLE_DB_DUMP=1 to enable)"
  fi

  # Retention for code backups (zip) — delete old archives beyond BACKUP_RETENTION_DAYS (default 7)
  BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-7}
  if [ -n "${BACKUP_RETENTION_DAYS}" ] && [ "${BACKUP_RETENTION_DAYS}" -gt 0 ] 2>/dev/null; then
    OLD_ZIPS=$(find "$BACKUP_ROOT" -type f -name '*livechat-app-backup.zip' -mtime +"$BACKUP_RETENTION_DAYS" -print 2>/dev/null | wc -l | tr -d ' ')
    find "$BACKUP_ROOT" -type f -name '*livechat-app-backup.zip' -mtime +"$BACKUP_RETENTION_DAYS" -delete >/dev/null 2>&1 || true
    log "Retention: deleted ${OLD_ZIPS:-0} code backup zip(s) older than ${BACKUP_RETENTION_DAYS} days"
  fi
  echo "[deploy][step] Code backup — PASSED"
else
  log "Skipping backup (deploy #$DEPLOY_COUNT; scheduled every $BACKUP_EVERY)"
  echo "[deploy][step] Code backup — SKIPPED"
fi

log "Starting deploy in $APP_ROOT"

### ---------- NPM HELPERS ----------
calc_lock_hash() {
  # Hash package-lock.json to decide if we can reuse existing node_modules without running npm ci.
  # Prefer sha256sum; fallback to shasum.
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum package-lock.json | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 package-lock.json | awk '{print $1}'
  else
    # No hashing tool available; force install.
    echo ""
  fi
}

maybe_npm_ci() {
  # Args are passed to npm ci (e.g. --omit=dev). Uses lock hash to skip work when unchanged.
  local stamp_file lock_hash old_hash
  stamp_file="node_modules/.lockhash"
  if [ -f package-lock.json ] && [ -d node_modules ]; then
    lock_hash="$(calc_lock_hash)"
    old_hash="$(cat "$stamp_file" 2>/dev/null || true)"
    if [ -n "$lock_hash" ] && [ "$lock_hash" = "$old_hash" ]; then
      log "npm: package-lock unchanged; skipping npm ci"
      return 0
    fi
  fi

  # Clean up any stale temp dirs from previous installs to avoid ENOTEMPTY
  rm -rf node_modules/.agentkeepalive-* 2>/dev/null || true

  # Run a lighter npm ci by default; audit/fund controlled via npm_config_* above.
  npm ci "$@" --no-audit --no-fund

  if [ -f package-lock.json ] && [ -d node_modules ]; then
    lock_hash="$(calc_lock_hash)"
    if [ -n "$lock_hash" ]; then
      echo "$lock_hash" >"$stamp_file" 2>/dev/null || true
    fi
  fi
}

### ---------- FREE SPACE CHECK ----------
# Ensure we have enough free space before building the frontend
check_free_space() {
  local path="$1"; local free_mb
  free_mb=$(df -Pm "$path" | awk 'NR==2 {print $4+0}')
  echo "$free_mb"
}

FRONTEND_MIN_FREE_MB=${FRONTEND_MIN_FREE_MB:-512}
FREE_MB=$(check_free_space "$APP_ROOT")
log "Free space on $(df -P "$APP_ROOT" | awk 'NR==2{print $1}') = ${FREE_MB} MB"
log "Free space threshold for frontend build = ${FRONTEND_MIN_FREE_MB} MB"
if [ "${FREE_MB}" -lt "${FRONTEND_MIN_FREE_MB}" ] 2>/dev/null; then
  log "Low disk space (< ${FRONTEND_MIN_FREE_MB} MB). Consider cleaning backups/logs or set SKIP_FRONTEND_BUILD=1."
  # Proactive light cleanup: flush PM2 logs and remove Vite cache
  pm2 flush >/dev/null 2>&1 || true
  rm -rf "$FRONTEND/node_modules/.vite" 2>/dev/null || true
  # Recompute free space after cleanup
  FREE_MB=$(check_free_space "$APP_ROOT")
  log "Free space after light cleanup = ${FREE_MB} MB"
fi

### ---------- BACKEND ----------
if [ -d "$BACKEND" ]; then
  echo "[deploy][step] Backend deps — START"
  log "Runtime: node=$(node -v 2>/dev/null || echo none) npm=$(npm -v 2>/dev/null || echo none) nvm=$(command -v nvm >/dev/null 2>&1 && nvm --version 2>/dev/null || echo none)"
  log "Backend: installing deps (omit dev)"
  pushd "$BACKEND" >/dev/null
  if [ -f package-lock.json ]; then
    maybe_npm_ci --omit=dev || {
      log "Backend: npm ci failed; syncing lockfile and retrying"
      npm install --package-lock-only || true
      maybe_npm_ci --omit=dev || {
        log "Backend: npm ci failed again; cleaning and retrying"
        rm -rf node_modules
        npm cache clean --force || true
        maybe_npm_ci --omit=dev || npm install --omit=dev --no-audit --no-fund
      }
    }
  else
    npm install --omit=dev --no-audit --no-fund
  fi
  log "Backend: dependencies installed"
  # Ensure Chromium browser is present for Playwright (skip if already installed)
  if command -v npx >/dev/null 2>&1; then
    BROWSERS_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
    CHR_PRESENT=0
    if [ -d "$BROWSERS_DIR" ]; then
      if find "$BROWSERS_DIR" -type f \
         \( -path "*/chromium-*/chrome-linux/chrome" \
            -o -path "*/chromium-*/chrome-linux/chrome-wrapper" \
            -o -path "*/chromium-*/chrome-win/chrome.exe" \
            -o -path "*/chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium" \) \
         -print -quit | grep -q .; then
        CHR_PRESENT=1
      fi
    fi
    if [ "$CHR_PRESENT" -eq 1 ]; then
      log "Backend: Playwright chromium already present in $BROWSERS_DIR"
    else
      log "Backend: installing Playwright chromium (first-time)"
      (cd "$BACKEND" && npx --yes playwright install chromium >/dev/null 2>&1 && log "Backend: Playwright chromium ready" || log "Backend: Playwright ensure skipped/failed (non-fatal)")
    fi
  fi
  echo "[deploy][step] Backend deps — PASSED"
  popd >/dev/null
else
  log "Backend folder not found (skipping)"
  echo "[deploy][step] Backend deps — SKIPPED"
fi

### ---------- OPTIONAL: DATABASE ACTIONS ----------
# You can toggle these from the environment when calling deploy.sh, e.g.:
#   DB_RESTART=1 ./deploy.sh               # restart Postgres service (Linux)
#   DB_TRUNCATE=1 ./deploy.sh              # delete rows from known tables (keep schema)
#   DB_RESET=1 ./deploy.sh                 # drop & recreate schema (DESTRUCTIVE)
# If both DB_TRUNCATE and DB_RESET are set, DB_RESET wins.

maybe_restart_postgres() {
  # Best-effort restart for common Linux setups; no-op if not found
  if command -v systemctl >/dev/null 2>&1; then
    for svc in postgresql postgresql@16-main postgresql@15-main postgresql@14-main; do
      if systemctl restart "$svc" >/dev/null 2>&1; then
        log "PostgreSQL restarted via systemctl ($svc)"
        return 0
      fi
    done
    log "PostgreSQL service not found via systemctl (skipping)"
  elif command -v service >/dev/null 2>&1; then
    service postgresql restart >/dev/null 2>&1 && {
      log "PostgreSQL restarted via service"
      return 0
    }
  else
    log "No service manager found to restart PostgreSQL (skipping)"
  fi
  return 0
}

if [ -n "${DB_TRUNCATE:-}" ] || [ -n "${DB_RESET:-}" ] || [ -n "${DB_RESTART:-}" ]; then
  log "DB: requested action(s): TRUNCATE=${DB_TRUNCATE:-0} RESET=${DB_RESET:-0} RESTART=${DB_RESTART:-0}"
fi

# Truncate or reset schema using backend/scripts/reset-db.js (uses backend/.env DATABASE_URL)
if [ -n "${DB_RESET:-}" ] || [ -n "${DB_TRUNCATE:-}" ]; then
  if [ -d "$BACKEND" ]; then
    pushd "$BACKEND" >/dev/null
    if [ -n "${DB_RESET:-}" ]; then
      log "DB: dropping & recreating schema (DESTRUCTIVE)"
      if npm run | grep -q '^ *db:reset'; then
        npm run db:reset || node scripts/reset-db.js --drop-schema
      else
        node scripts/reset-db.js --drop-schema
      fi
    elif [ -n "${DB_TRUNCATE:-}" ]; then
      log "DB: truncating tables (keep schema)"
      if npm run | grep -q '^ *db:truncate'; then
        npm run db:truncate || node scripts/reset-db.js
      else
        node scripts/reset-db.js
      fi
    fi
    popd >/dev/null
  else
    log "DB: backend folder missing; cannot run DB scripts"
  fi
fi

# Optional one-shot rebuild to reset column counter on chatbot_config
if [ -n "${DB_REBUILD_CHATBOT:-}" ]; then
  if [ -d "$BACKEND" ]; then
    log "DB: rebuilding chatbot_config (reset wide-table column count)"
    (cd "$BACKEND" && node scripts/rebuild-chatbot-config.js) || die "DB rebuild failed"
  else
    log "DB: backend folder missing; cannot run rebuild script"
  fi
fi

# Restart Postgres service if requested
if [ -n "${DB_RESTART:-}" ]; then
  maybe_restart_postgres || true
fi

# Minimal DB migration helper (psql). Avoids widening chatbot_config (1600-col limit).
ensure_db_ready() {
  # Discover DATABASE_URL from environment or backend/.env
  local DBURL="${DATABASE_URL:-}"
  if [ -z "$DBURL" ] && [ -f "$BACKEND/.env" ]; then
    DBURL=$(grep -E '^DATABASE_URL=' "$BACKEND/.env" | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"\|"$//g' -e "s/^'\|'$//g") || true
  fi
  if [ -z "$DBURL" ]; then
    log "DB: DATABASE_URL not set; skipping psql migrations"
    return 0
  fi
  if ! command -v psql >/dev/null 2>&1; then
    log "DB: psql not found; skipping direct SQL migrations (server will auto-migrate on first run)"
    return 0
  fi
  log "DB: DATABASE_URL detected; applying safe migrations via psql (no ALTER on chatbot_config)"
  # Lightweight retry wrapper for psql to handle transient slot exhaustion
  run_psql() {
    local url="$1"; shift
    local attempt=1
    local max="${PSQL_MAX_RETRIES:-6}"
    local delay="${PSQL_RETRY_DELAY_S:-1}"
    while true; do
      if psql "$url" -v ON_ERROR_STOP=1 "$@"; then
        return 0
      fi
      local ec=$?
      if [ $attempt -ge $max ]; then
        echo "[deploy] psql failed after ${attempt} attempts (exit $ec)"
        return $ec
      fi
      echo "[deploy] psql failed (attempt ${attempt}/${max}); retrying in ${delay}s..."
      sleep "$delay"
      attempt=$((attempt+1))
      # exponential backoff up to 8s default
      if [ "$delay" -lt 8 ]; then delay=$((delay*2)); fi
    done
  }
  run_psql "$DBURL" -c "CREATE TABLE IF NOT EXISTS public.settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMP DEFAULT NOW());" || true
  # Predefined welcome messages table
  run_psql "$DBURL" -c "CREATE TABLE IF NOT EXISTS public.welcome_message (id_message TEXT PRIMARY KEY, shop_name TEXT NOT NULL, lang_iso VARCHAR(16) NOT NULL, title TEXT, content TEXT, enabled BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());" || true
  run_psql "$DBURL" -c "CREATE UNIQUE INDEX IF NOT EXISTS welcome_message_shop_lang_unique ON public.welcome_message (shop_name, lang_iso);" || true
  # Link table for chatbot -> welcome message (no widening of chatbot_config)
  run_psql "$DBURL" -c "CREATE TABLE IF NOT EXISTS public.chatbot_welcome_link (id_bot TEXT PRIMARY KEY REFERENCES public.chatbot_config(id_bot) ON DELETE CASCADE, welcome_message_id TEXT NOT NULL REFERENCES public.welcome_message(id_message) ON DELETE RESTRICT, updated_at TIMESTAMP DEFAULT NOW());" || true
  # Ensure per-bot enabled flag exists on the link (kept unused for now)
  run_psql "$DBURL" -c "ALTER TABLE public.chatbot_welcome_link ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT FALSE;" || true
}

# Run minimal DB ensure step unless explicitly skipped, then apply SQL migrations (idempotent)
if [ -z "${SKIP_DB_ENSURE:-}" ]; then
  # Only run safe psql migrations; do NOT widen chatbot_config (avoids 1600-col errors)
  ensure_db_ready || true
  # Apply repo-level SQL migrations in lexicographic order (idempotent scripts recommended)
  DBURL_EFF="${DATABASE_URL:-}"
  if [ -z "$DBURL_EFF" ] && [ -f "$BACKEND/.env" ]; then
    DBURL_EFF=$(grep -E '^DATABASE_URL=' "$BACKEND/.env" | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"\|"$//g' -e "s/^'\|'$//g") || true
  fi
  if [ -n "$DBURL_EFF" ] && [ -d "$APP_ROOT/migrations" ]; then
    echo "[deploy] Applying SQL migrations in $APP_ROOT/migrations (tracked)"
    # Ensure central schema_migrations table exists
    run_psql "$DBURL_EFF" -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT NOW());" || true
    for sqlf in $(ls -1 "$APP_ROOT/migrations"/*.sql 2>/dev/null | sort); do
      base="$(basename "$sqlf")"
      applied=$(psql "$DBURL_EFF" -t -A -c "SELECT 1 FROM schema_migrations WHERE filename='${base}' LIMIT 1" 2>/dev/null | tr -d '\r\n' || true)
      if [ "$applied" = "1" ]; then
        echo "[deploy] skip ${base} (already applied)"
        continue
      fi
      echo "[deploy] apply ${base}"
      if run_psql "$DBURL_EFF" -f "$sqlf"; then
        run_psql "$DBURL_EFF" -c "INSERT INTO schema_migrations (filename) VALUES ('${base}') ON CONFLICT (filename) DO NOTHING;" || true
      else
        echo "[deploy] migration failed: ${base}" >&2
        # Do not exit deploy; leave for manual investigation
      fi
    done
  fi
  echo "[deploy][step] DB ensure — PASSED"
else
  echo "[deploy][step] DB ensure — SKIPPED"
fi

### ---------- FRONTEND ----------
# Skip the frontend build when SKIP_FRONTEND_BUILD=1 is set (useful for fast backend-only deploys)
if [ -n "${SKIP_FRONTEND_BUILD:-}" ]; then
  echo "[deploy][step] Frontend build — SKIPPED (SKIP_FRONTEND_BUILD=1)"
elif [ -d "$FRONTEND" ]; then
  echo "[deploy][step] Frontend build — START"
  log "Frontend: installing deps"
  pushd "$FRONTEND" >/dev/null
  # devDependencies are needed for vite build
  if [ -f package-lock.json ]; then
    maybe_npm_ci || {
      log "Frontend: npm ci failed; syncing lockfile and retrying"
      npm install --package-lock-only || true
      maybe_npm_ci || {
        log "Frontend: npm ci failed again; cleaning and retrying"
        rm -rf node_modules
        npm cache clean --force || true
        maybe_npm_ci || npm install --no-audit --no-fund
      }
    }
  else
    npm install --no-audit --no-fund
  fi

  # Explicitly ensure critical packages exist to avoid Vite resolve errors
  node - <<'NODECHECK' || die "Missing required frontend deps (see above)"
const mustHave = [
  'socket.io-client',
  '@tiptap/react',
  '@tiptap/starter-kit',
  '@tiptap/extension-link',
  '@tiptap/extension-placeholder',
  '@tiptap/extension-typography',
  '@tiptap/extension-history',
  '@emoji-mart/react',
  '@emoji-mart/data'
];
let missing = [];
for (const m of mustHave) { try { require.resolve(m); } catch { missing.push(m); } }
if (missing.length) {
  console.error('[deploy] Missing packages:', missing.join(', '));
  process.exit(1);
}
NODECHECK

  # Ensure no stale Vite cache or old dist/assets remain (prevents mixed-chunk clients)
  log "Frontend: cleaning caches and dist/assets"
  rm -rf node_modules/.vite 2>/dev/null || true
  if [ -d dist/assets ]; then
    rm -rf dist/assets/* 2>/dev/null || true
  fi
  rm -rf dist 2>/dev/null || true
  log "Frontend: caches cleared"

  # Preflight: detect JSX inside .js entries that would break vite's import analysis
  log "Frontend: preflight checks"
  JSX_SUSPECTS=$(find "$APP_ROOT/modules" -type f -path '*/frontend/index.js' -print 2>/dev/null | while read -r f; do
    if grep -Eq '<[A-Za-z]' "$f"; then echo "$f"; fi
  done)
  if [ -n "$JSX_SUSPECTS" ]; then
    echo "[deploy] ERROR: JSX detected in .js frontend entries (rename to .jsx or convert syntax):" >&2
    echo "$JSX_SUSPECTS" | sed 's/^/  - /' >&2
    echo "[deploy] Hint: Module Manager globs index.{js,jsx,ts,tsx}; prefer .jsx when using JSX." >&2
    exit 1
  fi

  log "Frontend: building (vite)"
  BUILD_LOG="${BUILD_LOG:-$FRONTEND/build.log}"
  # Compute a build id before invoking Vite; expose as VITE_BUILD_ID so vite.config can
  # place all outputs under assets/<build-id>/ to prevent mixed chunks.
  PREBUILD_TS="$(date +%s)"
  PREBUILD_GIT="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
  VITE_BUILD_ID="${PREBUILD_TS}-${PREBUILD_GIT}"
  : > "$BUILD_LOG" || true
  if [ -n "${FRONTEND_BUILD_FORCE:-}" ]; then
    set +e
    VITE_BUILD_ID="$VITE_BUILD_ID" npm run build -- --force 2>&1 | tee "$BUILD_LOG"
    BUILD_RC=${PIPESTATUS[0]:-1}
    set -e
  else
    set +e
    VITE_BUILD_ID="$VITE_BUILD_ID" npm run build 2>&1 | tee "$BUILD_LOG"
    BUILD_RC=${PIPESTATUS[0]:-1}
    set -e
  fi
  if [ "$BUILD_RC" -ne 0 ]; then
    echo "[deploy] Frontend build failed (exit $BUILD_RC). Key errors:" >&2
    # Extract vite parse errors and file hints
    grep -E "Parse error @:|error during build|\[vite\:|^file: |\^$" -n "$BUILD_LOG" | sed 's/^/  /' >&2 || true
    # Show context around any 'file:' sections (code frame with caret)
    while IFS= read -r line; do
      num="${line%%:*}"; rest="${line#*:}"
      case "$rest" in file:*)
        echo "[deploy] --- Context near $rest ---" >&2
        start=$(( num>10 ? num-10 : 1 ))
        end=$(( num+20 ))
        awk -v s="$start" -v e="$end" 'NR>=s && NR<=e {print "  "$0}' "$BUILD_LOG" >&2 || true
        ;;
      esac
    done < <(grep -n '^file: ' "$BUILD_LOG" || true)

    # Also surface raw Vite output so operators can see context like
    # 'vite vX building for production' and transform counts.
    echo "[deploy] --- Vite build output (excerpt) ---" >&2
    # If requested, print the full log; otherwise head/tail based on size
    if [ -n "${FRONTEND_BUILD_SHOW_FULL:-}" ]; then
      sed 's/^/  /' "$BUILD_LOG" >&2 || true
    else
      TOTAL_LINES=$(wc -l < "$BUILD_LOG" 2>/dev/null || echo 0)
      if [ "${TOTAL_LINES:-0}" -le 800 ]; then
        sed 's/^/  /' "$BUILD_LOG" >&2 || true
      else
        echo "[deploy] (showing first 80 lines)" >&2
        head -n 80 "$BUILD_LOG" | sed 's/^/  /' >&2 || true
        echo "[deploy] ... (truncated) ..." >&2
        echo "[deploy] (showing last 300 lines)" >&2
        tail -n 300 "$BUILD_LOG" | sed 's/^/  /' >&2 || true
      fi
    fi

    echo "[deploy] Full log: $BUILD_LOG" >&2
    exit $BUILD_RC
  fi

  # Minimal cache-busting: stamp build id into index.html and write a build file
  BUILD_TS="${PREBUILD_TS}"
  BUILD_GIT="${PREBUILD_GIT}"
  BUILD_ID="${VITE_BUILD_ID}"
  if [ -f dist/index.html ]; then
    printf '\n<!-- build:%s -->\n' "$BUILD_ID" >> dist/index.html || true
    printf '{"build":"%s","ts":%s}\n' "$BUILD_ID" "$BUILD_TS" > dist/__build.json || true
    printf '%s\n' "$BUILD_ID" > dist/__build.txt || true
    log "Frontend: stamped build id ${BUILD_ID}"
  fi
  # Publish a build log excerpt for in-app debug panel
  if [ -f "$BUILD_LOG" ] && [ -d dist ]; then
    tail -n 800 "$BUILD_LOG" > dist/__build.log || true
  fi
  if [ -d dist ]; then
    SIZE=$(du -sh dist 2>/dev/null | awk '{print $1}')
    log "Frontend: build complete (dist size ${SIZE:-unknown})"
  else
    log "Frontend: build complete"
  fi
  popd >/dev/null
else
  log "Frontend folder not found (skipping)"
  echo "[deploy][step] Frontend build — SKIPPED"
fi
if [ -d "$FRONTEND" ]; then echo "[deploy][step] Frontend build — PASSED"; fi

### ---------- PM2 RESTART ----------
if [ -d "$BACKEND" ]; then
  echo "[deploy][step] PM2 restart — START"
  pushd "$BACKEND" >/dev/null
  log "Restarting backend with PM2"
  if npm run | grep -q '^ *pm2:restart'; then
    # Use your package.json script if present
    npm run pm2:restart
  else
    # Fallback: try ecosystem first, else by name
    ECOS="ecosystem.config.cjs"
    if [ ! -f "$ECOS" ] && [ -f ecosystem.config.js ]; then ECOS="ecosystem.config.js"; fi
    if [ -f "$ECOS" ]; then
      log "PM2: using ecosystem $ECOS (name=$PM2_NAME)"
      if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
        pm2 restart "$ECOS" --only "$PM2_NAME" --update-env
      else
        pm2 start "$ECOS" --only "$PM2_NAME"
      fi
    else
      # Fallback to a direct script name; adjust if your entry file differs
      log "PM2: using direct name $PM2_NAME (no ecosystem file)"
      if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
        pm2 restart "$PM2_NAME" --update-env
      else
        pm2 start server.js --name "$PM2_NAME"
      fi
    fi
    pm2 save
  fi
  popd >/dev/null
fi
if [ -d "$BACKEND" ]; then echo "[deploy][step] PM2 restart — PASSED"; fi

### ---------- SMOKE TEST ----------
echo "[deploy][step] Smoke test — START"
log "Smoke test on 127.0.0.1:${APP_PORT}"
STATUS=''
for i in {1..90}; do
  STATUS="$(curl -sI "http://127.0.0.1:${APP_PORT}/__health" | head -n1 || true)"
  [ -n "$STATUS" ] && break
  sleep 1
done
echo "HTTP: ${STATUS:-'(no response)'}"
if [ -z "$STATUS" ]; then
  echo "[deploy] Backend did not respond; recent PM2 logs:" >&2
  # Use --nostream so the command returns instead of tailing forever
  pm2 logs "$PM2_NAME" --lines 60 --nostream || true
  # Fail the deploy so callers (tasks/CI) can detect the error
  exit 1
fi

echo "[deploy][step] Smoke test — PASSED"
log "Done."

### ---------- OPTIONAL: POST-DEPLOY MODULE CLEANUP ----------
# Use admin token (from env or backend/.env) to prune orphans and/or purge inactive sidebar links.
EFFECTIVE_ADMIN_TOKEN="${ADMIN_TOKEN:-}"
if [ -z "$EFFECTIVE_ADMIN_TOKEN" ] && [ -f "$BACKEND/.env" ]; then
  EFFECTIVE_ADMIN_TOKEN=$(grep -E '^ADMIN_TOKEN=' "$BACKEND/.env" | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"\|"$//g' -e "s/^'\|'$//g") || true
fi

# Optionally reload module routes so the runtime reflects newly synced code
if [ -n "$EFFECTIVE_ADMIN_TOKEN" ]; then
  echo "[deploy][post] Reloading module routes via API"
  curl -s -X POST -H "X-Admin-Token: $EFFECTIVE_ADMIN_TOKEN" "http://127.0.0.1:${APP_PORT}/api/module-manager/reload" | sed 's/^/[deploy][post] /' || true
fi

if [ -n "${PRUNE_ORPHANS:-}" ] && [ -n "$EFFECTIVE_ADMIN_TOKEN" ]; then
  echo "[deploy][post] Pruning orphan modules via API"
  curl -s -X POST -H "X-Admin-Token: $EFFECTIVE_ADMIN_TOKEN" "http://127.0.0.1:${APP_PORT}/api/module-manager/prune-orphans" | sed 's/^/[deploy][post] /' || true
fi
if [ -n "${PURGE_INACTIVE:-}" ] && [ -n "$EFFECTIVE_ADMIN_TOKEN" ]; then
  echo "[deploy][post] Purging inactive sidebar entries via API"
  curl -s -X POST -H "Content-Type: application/json" -H "X-Admin-Token: $EFFECTIVE_ADMIN_TOKEN" -d '{"reset_all_ui":true}' "http://127.0.0.1:${APP_PORT}/api/module-manager/purge-inactive" | sed 's/^/[deploy][post] /' || true
fi

### ---------- OPTIONAL: UPLOAD deploy.sh TO MCP‑DEV ----------
# Enable by setting MCP_DEV_POST=1, and optionally MCP_DEV_BASE and MCP_DEV_TOKEN
# Example:
#   MCP_DEV_POST=1 MCP_DEV_BASE="https://your.host" MCP_DEV_TOKEN="..." ./deploy.sh
if [ -n "${MCP_DEV_POST:-}" ]; then
  BASE="${MCP_DEV_BASE:-http://127.0.0.1:${APP_PORT}}"
  TOK_QS=""
  if [ -n "${MCP_DEV_TOKEN:-}" ]; then
    TOK_QS="?token=$(printf '%s' "$MCP_DEV_TOKEN" | sed -e 's/%/%25/g' -e 's/+/%2B/g' -e 's/&/%26/g' -e 's/?/%3F/g')"
  fi
  TARGET="${BASE%/}/mcp-dev/files/base64${TOK_QS}"
  log "Uploading deploy.sh to MCP‑DEV: $TARGET"

  # Cross-platform base64 without line breaks
  if base64 --help 2>/dev/null | grep -q -- '--wrap'; then
    B64=$(base64 --wrap=0 < "$APP_ROOT/deploy.sh")
  else
    # macOS/BSD
    B64=$(base64 -b 0 < "$APP_ROOT/deploy.sh" 2>/dev/null || base64 < "$APP_ROOT/deploy.sh")
    B64=$(printf '%s' "$B64" | tr -d '\n')
  fi

  JSON_PAYLOAD=$(cat <<JSON
{ "filename": "deploy.sh", "content_base64": "${B64}", "content_type": "text/x-shellscript" }
JSON
)
  HTTP_CODE=$(curl -s -o /tmp/mcp_dev_upload.out -w '%{http_code}' -X POST "$TARGET" \
    -H 'Content-Type: application/json' \
    --data "$JSON_PAYLOAD" || true)
  echo "[deploy] MCP‑DEV upload HTTP $HTTP_CODE"
  if [ "$HTTP_CODE" != "200" ]; then
    echo "[deploy] MCP‑DEV upload failed:" >&2
    cat /tmp/mcp_dev_upload.out >&2 || true
  fi
  rm -f /tmp/mcp_dev_upload.out 2>/dev/null || true
fi


# Jerome PG migration is disabled by default. Enable explicitly if needed.
# Be robust to nested layouts (backend/ or livechat-app/backend)
BACKEND_FOUND=""
for CAND in "$BACKEND" "$APP_ROOT/livechat-app/backend"; do
  if [ -d "$CAND" ]; then BACKEND_FOUND="$CAND"; break; fi
done

if [ -n "$BACKEND_FOUND" ]; then
  # Determine effective GRB_JEROME_STORE: prefer env, else read from .env
  EFFECTIVE_STORE="${GRB_JEROME_STORE:-}"
  ENV_FILE="$BACKEND_FOUND/.env"
  if [ -z "$EFFECTIVE_STORE" ] && [ -f "$ENV_FILE" ]; then
    EFFECTIVE_STORE=$(grep -E '^GRB_JEROME_STORE=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"\|"$//g' -e "s/^'\|'$//g") || true
  fi
  if [ "$EFFECTIVE_STORE" = "pg" ] && [ -n "${ENABLE_JEROME_MIGRATE:-}" ]; then
    log "DB: migrating Jerome data to PostgreSQL (ensure tables + import) in $BACKEND_FOUND (ENABLE_JEROME_MIGRATE=1)"
    (cd "$BACKEND_FOUND" && npm run db:migrate:jerome) || log "DB: migrate-jerome step failed (continuing)"
  else
    log "DB: Jerome migration disabled (set ENABLE_JEROME_MIGRATE=1 and GRB_JEROME_STORE=pg to enable)"
  fi
else
  log "DB: backend folder missing; cannot run Jerome migration"
fi

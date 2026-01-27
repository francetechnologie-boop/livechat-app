#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/root/livechat-app-backup"
APP_DIR="/root/livechat-app"
PM2_NAME="livechat"
AUTO_CONFIRM=0
LIST_ONLY=0
SKIP_RESTART=0
RESTART_CMD=""

usage() {
  cat <<'USAGE'
Usage: restore_from_back_up.sh [options]

Options:
  --backup-dir PATH   Backup directory to scan (default: /root/livechat-app-backup)
  --app-dir PATH      Destination installation directory (default: /root/livechat-app)
  --list-only         Only list backups; skip restore
  --pm2-name NAME     PM2 process name to restart (default: livechat)
  --restart-cmd CMD   Custom restart command (bypasses PM2 logic)
  --skip-restart      Skip restarting the application after restore
  -y, --yes           Assume yes for confirmation prompt
  -h, --help          Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-dir)
      [[ $# -lt 2 ]] && { echo "Error: --backup-dir requires a value" >&2; exit 1; }
      BACKUP_DIR="$2"
      shift 2
      ;;
    --app-dir)
      [[ $# -lt 2 ]] && { echo "Error: --app-dir requires a value" >&2; exit 1; }
      APP_DIR="$2"
      shift 2
      ;;
    --list-only)
      LIST_ONLY=1
      shift
      ;;
    --pm2-name)
      [[ $# -lt 2 ]] && { echo "Error: --pm2-name requires a value" >&2; exit 1; }
      PM2_NAME="$2"
      shift 2
      ;;
    --restart-cmd)
      [[ $# -lt 2 ]] && { echo "Error: --restart-cmd requires a value" >&2; exit 1; }
      RESTART_CMD="$2"
      shift 2
      ;;
    --skip-restart)
      SKIP_RESTART=1
      shift
      ;;
    -y|--yes)
      AUTO_CONFIRM=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: Unknown option $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Error: Backup directory '$BACKUP_DIR' does not exist" >&2
  exit 1
fi

shopt -s nullglob dotglob
backups=("$BACKUP_DIR"/*)
shopt -u dotglob

if [[ ${#backups[@]} -eq 0 ]]; then
  echo "No backups found in $BACKUP_DIR" >&2
  exit 1
fi

echo "Available backups in $BACKUP_DIR:"
index=1
for backup_path in "${backups[@]}"; do
  backup_name="$(basename "$backup_path")"
  if stat_output=$(stat -c '%y|%s' "$backup_path" 2>/dev/null); then
    mod_time="${stat_output%%|*}"
    size_bytes="${stat_output##*|}"
  elif stat_output=$(stat -f '%Sm|%z' -t '%Y-%m-%d %H:%M:%S' "$backup_path" 2>/dev/null); then
    mod_time="${stat_output%%|*}"
    size_bytes="${stat_output##*|}"
  else
    mod_time="?"
    size_bytes="?"
  fi
  printf '  [%2d] %-40s %s (%s bytes)\n' "$index" "$backup_name" "$mod_time" "$size_bytes"
  ((index++))
done

if [[ $LIST_ONLY -eq 1 ]]; then
  exit 0
fi

read -rp "Select a backup to restore (1-${#backups[@]}): " selection
if ! [[ $selection =~ ^[0-9]+$ ]] || (( selection < 1 || selection > ${#backups[@]} )); then
  echo "Invalid selection" >&2
  exit 1
fi

selected_backup="${backups[selection-1]}"
selected_name="$(basename "$selected_backup")"

echo "You selected: $selected_name"

if [[ $AUTO_CONFIRM -ne 1 ]]; then
  read -rp "This will replace the contents of $APP_DIR. Continue? [y/N]: " confirm
  if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo "Restore aborted."
    exit 0
  fi
fi

mkdir -p "$(dirname "$APP_DIR")"

restore_source=""
cleanup_dir=""

cleanup() {
  if [[ -n "$cleanup_dir" && -d "$cleanup_dir" ]]; then
    rm -rf "$cleanup_dir"
  fi
}
trap cleanup EXIT

case "$selected_backup" in
  *.tar.gz|*.tgz)
    cleanup_dir="$(mktemp -d)"
    tar -xzf "$selected_backup" -C "$cleanup_dir"
    ;;
  *.tar)
    cleanup_dir="$(mktemp -d)"
    tar -xf "$selected_backup" -C "$cleanup_dir"
    ;;
  *.zip)
    if ! command -v unzip >/dev/null 2>&1; then
      echo "Error: unzip is required to restore from zip archives" >&2
      exit 1
    fi
    cleanup_dir="$(mktemp -d)"
    unzip -q "$selected_backup" -d "$cleanup_dir"
    ;;
  *)
    if [[ -d "$selected_backup" ]]; then
      restore_source="$selected_backup"
    else
      echo "Error: Unsupported backup format for '$selected_backup'" >&2
      exit 1
    fi
    ;;
esac

if [[ -z "$restore_source" ]]; then
  shopt -s nullglob dotglob
  extracted=("$cleanup_dir"/*)
  shopt -u dotglob
  if [[ ${#extracted[@]} -eq 1 && -d "${extracted[0]}" ]]; then
    restore_source="${extracted[0]}"
  else
    restore_source="$cleanup_dir"
  fi
fi

if [[ -d "$APP_DIR" || -L "$APP_DIR" ]]; then
  timestamp="$(date +%Y%m%d%H%M%S)"
  previous_dir="${APP_DIR}.${timestamp}.previous"
  echo "Existing installation found. Moving it to $previous_dir"
  mv "$APP_DIR" "$previous_dir"
  echo "Previous installation saved at $previous_dir"
fi

mkdir -p "$APP_DIR"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$restore_source"/ "$APP_DIR"/
else
  shopt -s dotglob
  cp -a "$restore_source"/. "$APP_DIR"/
  shopt -u dotglob
fi

echo "Restore complete. $APP_DIR now reflects backup '$selected_name'."

restart_with_pm2() {
  local ecos=""
  if [[ -f "ecosystem.config.cjs" ]]; then
    ecos="ecosystem.config.cjs"
  elif [[ -f "ecosystem.config.js" ]]; then
    ecos="ecosystem.config.js"
  fi

  if [[ -n "$ecos" ]]; then
    if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
      pm2 restart "$ecos" --only "$PM2_NAME" --update-env || return 1
    else
      pm2 start "$ecos" --only "$PM2_NAME" || return 1
    fi
  else
    local entry="server.js"
    if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
      pm2 restart "$PM2_NAME" --update-env || return 1
    else
      pm2 start "$entry" --name "$PM2_NAME" || return 1
    fi
  fi

  pm2 save >/dev/null 2>&1 || true
  return 0
}

restart_app() {
  if [[ -n "$RESTART_CMD" ]]; then
    echo "Running custom restart command"
    if bash -lc "$RESTART_CMD"; then
      return 0
    fi
    return 1
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    echo "pm2 not found; cannot restart automatically" >&2
    return 1
  fi

  local backend_dir="$APP_DIR/backend"
  if [[ ! -d "$backend_dir" ]]; then
    echo "Backend directory '$backend_dir' missing; skipping restart" >&2
    return 1
  fi

  if ( cd "$backend_dir" && restart_with_pm2 ); then
    return 0
  fi

  return 1
}

if [[ $SKIP_RESTART -eq 0 ]]; then
  echo "Attempting to restart livechat-app"
  if restart_app; then
    echo "Application restart completed."
  else
    echo "Warning: automatic restart failed. Please restart manually." >&2
  fi
fi

trap - EXIT
cleanup
